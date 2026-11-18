// Two back ends behind one interface: LIVE reads X Layer (eth_call, no backend server), DEMO evaluates
// the toy circuit in the browser. Both verify the snapshot Merkle proof locally before trusting bits.
import { concat, toHex, createPublicClient, createWalletClient, custom, defineChain, encodePacked, fallback, getAddress,
  http, keccak256, parseAbi, type Hex } from "viem";
import { CONFIG, LIVE } from "./config";
import { decide, parse, type Net } from "./tap02";
import { unpack } from "../../data/features";
import toyNetlist from "../../build/toy.netlist.json";
import demoSnapshot from "../../build/demo_snapshot.json";
import toyTestLeaves from "../../build/toy_test_leaves.json";

export const xlayer = defineChain({ id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: CONFIG.rpc } }, blockExplorers: { default: { name: "OKLink", url: CONFIG.explorer } } });
export const client = createPublicClient({ chain: xlayer, transport: fallback(CONFIG.rpc.map(u => http(u))) });

const campaignAbi = parseAbi([
  "function verdictOf(uint256 id, address wallet, bytes8 bits, bytes32[] proof) view returns (bool verdict, uint8 margin)",
  "function campaign(uint256 id) view returns ((address owner, bytes32 netlistHash, bytes32 extractorHash, uint64 snapshotBlock, uint64 commitBlock, bytes32 vectorsRoot, string vectorsURI, uint256 modelId, bool bound))",
]);
const procAbi = parseAbi([
  "function netlist(uint256 id) view returns (bytes)",
  "function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)",
]);
const registryAbi = parseAbi([
  "function model(uint256 id) view returns ((address owner, address processor, uint256 circuitId, bytes32 netlistHash, bytes32 extractorHash, uint256 testCommitId, uint32 gateCount, uint64 registeredBlock, string cardURI))",
]);
const auditAbi = parseAbi([
  "function K() view returns (uint16)",
  "function testCommits(uint256) view returns (address owner, bytes32 root, uint32 size, uint64 blockNumber)",
  "function roundCount() view returns (uint256)",
  "function rounds(uint256) view returns (uint256 modelId, uint64 targetBlock, bool done, uint16 correct, uint16 total)",
  "function status(uint256 roundId) view returns (uint8)",
  "function sampleIndices(uint256 roundId) view returns (uint32[])",
  "function requestAudit(uint256 modelId) returns (uint256)",
  "function finalizeAudit(uint256 roundId, (uint32 index, bytes8 bits, bool label)[] rows, bytes32[][] proofs) returns (uint16, uint16)",
  "event AuditRequested(uint256 indexed roundId, uint256 indexed modelId, uint64 targetBlock)",
]);

type Snapshot = { campaignId: number; block: number; root: Hex; extractorHash: Hex; wallets: Record<string, { bits: Hex; proof: Hex[] }> };
type TestLeaves = { root: Hex; size: number; leaves: { index: number; bits: Hex; label: number; leaf: Hex; proof: Hex[] }[] };

// ------------------------------------------------------------------ helpers

/** OpenZeppelin MerkleProof.processProof with sorted pairs. */
export function merkleRoot(leaf: Hex, proof: Hex[]): Hex {
  return proof.reduce<Hex>((h, p) => keccak256(h.toLowerCase() < p.toLowerCase() ? concat([h, p]) : concat([p, h])), leaf);
}
const snapshotLeaf = (w: Hex, bits: Hex) => keccak256(encodePacked(["address", "bytes8"], [w, bits]));

let snapshot: Snapshot | undefined;
async function getSnapshot(): Promise<Snapshot> {
  if (!snapshot) snapshot = LIVE ? await (await fetch(CONFIG.snapshotUrl)).json() : (demoSnapshot as Snapshot);
  return snapshot!;
}
export const sampleWallets = async () => Object.keys((await getSnapshot()).wallets);

let net: Net | undefined;
export async function loadNet(): Promise<Net> {
  if (net) return net;
  if (!LIVE) return (net = parse(toyNetlist.netlist as Hex, toyNetlist.nIn, toyNetlist.nOut));
  const [nIn, nOut] = await client.readContract({ address: CONFIG.processor, abi: procAbi, functionName: "circuitInfo", args: [CONFIG.circuitId] });
  const hex = await client.readContract({ address: CONFIG.processor, abi: procAbi, functionName: "netlist", args: [CONFIG.circuitId] });
  return (net = parse(hex, nIn, nOut));
}

// ------------------------------------------------------------------ check

export type CheckResult =
  | { status: "invalid"; input: string }
  | { status: "not-in-snapshot"; wallet: Hex }
  | { status: "ok"; wallet: Hex; bits: number[]; bitsHex: Hex; verdict: boolean; margin: number; root: Hex;
      localVerdict: boolean; source: "X Layer eth_call" | "in-browser (demo)" };

export async function checkWallet(input: string): Promise<CheckResult> {
  let wallet: Hex;
  try { wallet = getAddress(input.trim()); } catch { return { status: "invalid", input }; }
  const snap = await getSnapshot(), entry = snap.wallets[wallet.toLowerCase()];
  if (!entry) return { status: "not-in-snapshot", wallet };
  let root = snap.root;
  if (LIVE) root = (await client.readContract({ address: CONFIG.campaign, abi: campaignAbi, functionName: "campaign", args: [CONFIG.campaignId] })).vectorsRoot;
  if (merkleRoot(snapshotLeaf(wallet, entry.bits), entry.proof).toLowerCase() !== root.toLowerCase())
    throw new Error("Snapshot proof does not match the root on chain. Report this.");
  const bits = unpack(entry.bits), n = await loadNet(), local = decide(n, bits);
  if (!LIVE) return { status: "ok", wallet, bits, bitsHex: entry.bits, ...local, root, localVerdict: local.verdict, source: "in-browser (demo)" };
  const [verdict, margin] = await client.readContract({ address: CONFIG.campaign, abi: campaignAbi,
    functionName: "verdictOf", args: [CONFIG.campaignId, wallet, entry.bits, entry.proof] });
  return { status: "ok", wallet, bits, bitsHex: entry.bits, verdict, margin: Number(margin) - 32, root, localVerdict: local.verdict, source: "X Layer eth_call" };
}

// ------------------------------------------------------------------ audit

export const STATUS = ["none", "pending", "ready", "done", "expired"] as const;
export type Round = { id: number; status: (typeof STATUS)[number]; correct: number; total: number };
export type AuditInfo = { k: number; testRoot: Hex; testSize: number; netlistHash?: Hex; committedHash?: Hex; bound?: boolean;
  snapshotBlock?: number; rounds: Round[] };

let demoRounds: Round[] = [];
let leavesCache: TestLeaves | undefined;
const testLeaves = async (): Promise<TestLeaves> =>
  leavesCache ??= LIVE ? await (await fetch(CONFIG.testLeavesUrl)).json() : (toyTestLeaves as TestLeaves);

export async function auditInfo(): Promise<AuditInfo> {
  if (!LIVE) { const t = await testLeaves(); return { k: 16, testRoot: t.root, testSize: t.size, rounds: demoRounds }; }
  const m = await client.readContract({ address: CONFIG.registry, abi: registryAbi, functionName: "model", args: [CONFIG.modelId] });
  const c = await client.readContract({ address: CONFIG.campaign, abi: campaignAbi, functionName: "campaign", args: [CONFIG.campaignId] });
  const [, testRoot, testSize] = await client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "testCommits", args: [m.testCommitId] });
  const k = await client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "K" });
  const n = Number(await client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "roundCount" }));
  const rounds: Round[] = [];
  for (let i = n - 1; i >= 0 && rounds.length < 50; i--) {
    const [modelId, , , correct, total] = await client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "rounds", args: [BigInt(i)] });
    if (modelId !== CONFIG.modelId) continue;
    const st = await client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "status", args: [BigInt(i)] });
    rounds.push({ id: i, status: STATUS[st], correct, total });
  }
  return { k, testRoot, testSize, netlistHash: m.netlistHash, committedHash: c.netlistHash, bound: c.bound, snapshotBlock: Number(c.snapshotBlock), rounds };
}

/** Demo: same rule as the contract (K rows picked by a block hash), but the "block hash" is random and
 *  the circuit runs in the browser. Live: two transactions from the visitor's wallet. */
export async function runAudit(log: (s: string) => void): Promise<Round> {
  const t = await testLeaves(), n = await loadNet();
  if (!LIVE) {
    const seed = crypto.getRandomValues(new Uint8Array(32)), k = 16, id = demoRounds.length;
    let correct = 0;
    for (let j = 0; j < k; j++) {
      const h = keccak256(concat([toHex(seed), encodePacked(["uint256", "uint256"], [BigInt(id), BigInt(j)])]));
      const row = t.leaves[Number(BigInt(h) % BigInt(t.size))];
      if (merkleRoot(row.leaf, row.proof) !== t.root) throw new Error("bad test proof");
      const ok = decide(n, unpack(row.bits)).verdict === (row.label === 1);
      correct += ok ? 1 : 0;
      log(`row ${row.index}: label ${row.label}, model ${ok ? "agrees" : "disagrees"}`);
    }
    const r: Round = { id, status: "done", correct, total: k };
    demoRounds = [r, ...demoRounds];
    return r;
  }
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet found. Install a wallet (e.g. OKX Wallet) to run an audit.");
  const wallet = createWalletClient({ chain: xlayer, transport: custom(eth) });
  const [account] = await wallet.requestAddresses();
  await wallet.switchChain({ id: 196 }).catch(() => wallet.addChain({ chain: xlayer }));
  log("1/2 requestAudit: fixes the next block, whose hash picks the rows");
  const h1 = await wallet.writeContract({ account, address: CONFIG.audit, abi: auditAbi, functionName: "requestAudit", args: [CONFIG.modelId] });
  const rc = await client.waitForTransactionReceipt({ hash: h1 });
  const ev = rc.logs.find(l => l.address.toLowerCase() === CONFIG.audit.toLowerCase());
  const roundId = BigInt(ev!.topics[1]!);
  while (await client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "status", args: [roundId] }) === 1)
    await new Promise(r => setTimeout(r, 1200));
  const idx = await client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "sampleIndices", args: [roundId] });
  log(`rows picked: ${idx.join(", ")}`);
  const rows = idx.map(i => ({ index: i, bits: t.leaves[i].bits, label: t.leaves[i].label === 1 }));
  log("2/2 finalizeAudit: the contract checks each proof and runs eval on chain (must land within ~4 minutes)");
  const h2 = await wallet.writeContract({ account, address: CONFIG.audit, abi: auditAbi, functionName: "finalizeAudit",
    args: [roundId, rows, idx.map(i => t.leaves[i].proof)] });
  await client.waitForTransactionReceipt({ hash: h2 });
  const [, , , correct, total] = await client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "rounds", args: [roundId] });
  return { id: Number(roundId), status: "done", correct, total };
}
