// Live mode: everything that talks to X Layer. Loaded with import() only when the contracts are configured
// (or a page needs one RPC read), so demo visitors never download the RPC client.
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, custom, defineChain, fallback,
  http, parseAbi, parseEventLogs, sha256, type EIP1193Provider, type Hex, type TransactionReceipt } from "viem";
import { CONFIG } from "./config";

export const xlayer = defineChain({
  id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: CONFIG.rpc } }, blockExplorers: { default: { name: "OKLink", url: CONFIG.explorer } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },   // deployed on X Layer
});
/** Concurrent reads are batched into one multicall; three RPCs, each retried, fail over in order. */
export const client = createPublicClient({ chain: xlayer, batch: { multicall: true },
  transport: fallback(CONFIG.rpc.map(u => http(u, { retryCount: 1, timeout: 15_000 }))) });

export const campaignAbi = parseAbi([
  "function verdictOf(uint256 id, uint32 index, address wallet, bytes8 bits, bytes32[] proof) view returns (bool verdict, uint8 margin)",
  "function campaign(uint256 id) view returns ((address owner, bytes32 netlistHash, bytes32 extractorHash, uint64 snapshotBlock, uint64 commitBlock, uint256 testCommitId, bytes32 vectorsRoot, uint32 vectorsCount, uint8 vectorsDepth, string vectorsURI, uint256 modelId, bool bound, bool invalid))",
  "function campaignsOf(address owner) view returns (uint256[])",
  "error SnapshotTooSoon()", "error BindWindowClosed()", "error TestSetMismatch()", "error NotOwner()", "error BeforeSnapshot()",
  "error PublishWindowClosed()", "error BadTree()", "error AlreadyPublished()", "error NotPublished()", "error AlreadyBound()",
  "error NetlistMismatch()", "error ExtractorMismatch()", "error TestSetAfterCommit()", "error NotBound()", "error Invalid()",
  "error NotInSnapshot()", "error NotADuplicate()",
]);
export const registryAbi = parseAbi([
  "function model(uint256 id) view returns ((address owner, address processor, uint256 circuitId, bytes32 netlistHash, bytes32 extractorHash, uint256 testCommitId, uint32 gateCount, uint64 registeredBlock, string cardURI))",
]);
const procAbi = parseAbi([
  "function netlist(uint256 id) view returns (bytes)",
  "function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)",
]);
export const auditAbi = parseAbi([
  "function K() view returns (uint16)",
  "function testCommits(uint256) view returns (address owner, bytes32 root, uint32 size, uint8 depth, uint64 blockNumber, bool invalid)",
  "function roundsOfModel(uint256 modelId) view returns (uint256[])",
  "function roundCount() view returns (uint256)",
  "function openRound(uint256 modelId) view returns (uint256)",
  "function rounds(uint256) view returns (uint256 modelId, address requester, uint64 targetBlock, bytes32 seed, bool done, uint16 correct, uint16 total, uint16 scored)",
  "function status(uint256 roundId) view returns (uint8)",
  "function sampleIndices(uint256 roundId) view returns (uint32[])",
  "function requestAudit(uint256 modelId) returns (uint256)",
  "function seal(uint256 roundId)",
  "function finalizeAudit(uint256 roundId, (uint32 index, address wallet, bytes8 bits, bool label)[] rows, bytes32[][] proofs) returns (uint16, uint16)",
  "event AuditRequested(uint256 indexed roundId, uint256 indexed modelId, address indexed requester, uint64 targetBlock)",
  "error BadK()", "error Locked()", "error RegistryMismatch()", "error BadTree()", "error TestSetTooSmall()", "error RoundOpen(uint256 roundId)",
  "error TestSetVoid()", "error NotEmpty()",
  "error NotReady(uint8 status)", "error HashUnavailable()", "error WrongRowCount()", "error WrongRow(uint256 j, uint32 expected)", "error BadProof(uint256 j)",
]);

const ERRORS: Record<string, string> = {
  RoundOpen: "Another audit round for this model is still open; the button finalizes that one.",
  NotReady: "The round isn't ready: its block hash is not out yet, or the round already finished or expired.",
  NotBound: "The campaign isn't bound to a model yet.", TestSetVoid: "This model's test set was voided: it claimed more rows than it holds.",
  TestSetMismatch: "The model was scored on a different test set than the campaign pinned.",
  HashUnavailable: "The round's block hash is no longer readable (more than 256 blocks passed without a seal).",
  WrongRow: "A row doesn't match the rows the block hash picked.", BadProof: "A test row's proof doesn't match the committed test set.",
  WrongRowCount: "Wrong number of rows for this round.", NotInSnapshot: "This wallet's bits are not in the committed snapshot.",
  Invalid: "This campaign was invalidated: its snapshot lists a wallet twice.",
};
/** A readable message for a failed call: contract errors by name, wallet rejections in plain words. */
export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const rev = e.walk(x => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = rev?.data?.errorName;
    if (name) return ERRORS[name] ?? `The contract refused: ${name}.`;
    if ((e.walk() as { code?: number }).code === 4001 || /rejected|denied/i.test(e.shortMessage)) return "You rejected the request in your wallet.";
    if (/HTTP request failed|timed? ?out|fetch failed/i.test(e.shortMessage)) return "X Layer's RPC didn't answer. Check your connection and try again.";
    return e.shortMessage;
  }
  return (e as Error)?.message ?? String(e);
}

// ------------------------------------------------------------------ reads

export const readCampaign = () => client.readContract({ address: CONFIG.campaign, abi: campaignAbi, functionName: "campaign", args: [CONFIG.campaignId] });
export const readModel = (id: bigint) => client.readContract({ address: CONFIG.registry, abi: registryAbi, functionName: "model", args: [id] });

/** The bound model's netlist, read from its processor and checked against the hash the registry computed. */
export async function boundNetlist(): Promise<{ hex: Hex; nIn: number; nOut: number; hash: Hex }> {
  const c = await readCampaign();
  if (!c.bound) throw new Error(ERRORS.NotBound);
  const m = await readModel(c.modelId);
  const [info, hex] = await Promise.all([
    client.readContract({ address: m.processor, abi: procAbi, functionName: "circuitInfo", args: [m.circuitId] }),
    client.readContract({ address: m.processor, abi: procAbi, functionName: "netlist", args: [m.circuitId] }),
  ]);
  const hash = sha256(hex);
  if (hash.toLowerCase() !== m.netlistHash.toLowerCase()) throw new Error("The processor's netlist doesn't match the registered hash.");
  return { hex, nIn: info[0], nOut: info[1], hash };
}

export async function verdictOf(index: number, wallet: Hex, bits: Hex, proof: Hex[]) {
  const [verdict, margin] = await client.readContract({ address: CONFIG.campaign, abi: campaignAbi, functionName: "verdictOf",
    args: [CONFIG.campaignId, index, wallet, bits, proof] });
  return { verdict, margin: Number(margin) - 32 };
}

export const STATUS = ["none", "pending", "ready", "done", "expired", "void"] as const;
export type Round = { id: number; status: (typeof STATUS)[number]; correct: number; total: number; scored: number; requester: Hex };

/** Every round ever requested for the bound model (roundsOfModel), so rounds on other models can't push
 *  this model's history out of view. Throws a plain message until the campaign is bound. */
export async function auditState() {
  const c = await readCampaign();
  if (!c.bound) throw new Error(ERRORS.NotBound);
  const m = await readModel(c.modelId);
  const [t, k, open, ids] = await Promise.all([
    client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "testCommits", args: [c.testCommitId] }),
    client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "K" }),
    client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "openRound", args: [c.modelId] }),
    client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "roundsOfModel", args: [c.modelId] }),
  ]);
  const newest = [...ids].reverse();
  const [rs, sts] = await Promise.all([
    Promise.all(newest.map(i => client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "rounds", args: [i] }))),
    Promise.all(newest.map(i => client.readContract({ address: CONFIG.audit, abi: auditAbi, functionName: "status", args: [i] }))),
  ]);
  const rounds: Round[] = rs.map((r, j) => ({ id: Number(newest[j]), status: STATUS[sts[j]], correct: r[5], total: r[6], scored: r[7], requester: r[1] }));
  return { modelId: c.modelId, k, testRoot: t[1], testSize: t[2], testDepth: t[3], testOwner: t[0], testVoid: t[5], modelOwner: m.owner,
    openRound: open ? Number(open) - 1 : -1, netlistHash: m.netlistHash, committedHash: c.netlistHash, bound: c.bound, invalid: c.invalid, rounds };
}

// ------------------------------------------------------------------ wallet

type Announced = { info: { rdns: string; name: string }; provider: EIP1193Provider };
/** EIP-6963 wallet discovery (OKX Wallet preferred), falling back to window.ethereum. */
async function provider(): Promise<EIP1193Provider> {
  const found: Announced[] = [];
  const on = (e: Event) => found.push((e as CustomEvent<Announced>).detail);
  window.addEventListener("eip6963:announceProvider", on);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise(r => setTimeout(r, 250));
  window.removeEventListener("eip6963:announceProvider", on);
  const pick = found.find(p => /okex|okx/i.test(p.info.rdns)) ?? found[0];
  const eth = pick?.provider ?? (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) throw new Error("No wallet found. Install a wallet (e.g. OKX Wallet) to send transactions.");
  return eth;
}

export async function connect() {
  const wallet = createWalletClient({ chain: xlayer, transport: custom(await provider()) });
  const [account] = await wallet.requestAddresses();
  if ((await wallet.getChainId()) !== xlayer.id) {
    try { await wallet.switchChain({ id: xlayer.id }); }
    catch (e) {
      const code = (e as { code?: number; cause?: { code?: number } }).code ?? (e as { cause?: { code?: number } }).cause?.code;
      if (code !== 4902) throw e;   // 4902 = chain unknown to the wallet: add it, then switch
      await wallet.addChain({ chain: xlayer });
      await wallet.switchChain({ id: xlayer.id });
    }
  }
  return { wallet, account };
}

export async function mined(hash: Hex): Promise<TransactionReceipt> {
  const rc = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (rc.status !== "success") throw new Error(`Transaction ${hash.slice(0, 10)}… reverted.`);
  return rc;
}

export { parseEventLogs };
