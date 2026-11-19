// One interface, two back ends. LIVE reads X Layer through live.ts (loaded on demand); DEMO evaluates the
// shipped circuit in the browser on the published snapshot. Both verify every Merkle proof locally first.
import { encodePacked, keccak256, concat, toHex, type Hex } from "viem";
import { CONFIG, LIVE } from "./config";
import { decide, parse, type Net } from "./tap02";
import { unpack } from "../../data/features";
import { testLeaf, verify } from "../../data/merkle_core";
import card from "../public/model/model_card.json";
import netlistJson from "../../build/cusity.netlist.json";   // the circuit the model card describes
import { checksum, inSnapshot, rebuildTestRoot, shardOf, snapshotIndex, testLeaves } from "./data";

export const live = () => import("./live");

// ------------------------------------------------------------------ circuit

let netP: Promise<{ net: Net; matchesCard: boolean }> | undefined;
/** The circuit to evaluate. Live: the bound circuit from its processor, hash-checked; `matchesCard` says
 *  whether it is the model this site's stage pages and card describe. */
export function loadCircuit() {
  if (!netP) {
    netP = (async () => {
      if (!LIVE) return { net: parse(netlistJson.netlist as Hex, netlistJson.nIn, netlistJson.nOut), matchesCard: true };
      const n = await (await live()).boundNetlist();
      return { net: parse(n.hex, n.nIn, n.nOut), matchesCard: n.hash.toLowerCase() === card.netlistSha256.toLowerCase() };
    })();
    netP.catch(() => { netP = undefined; });
  }
  return netP;
}
export const loadNet = async () => (await loadCircuit()).net;

// ------------------------------------------------------------------ check

export type CheckResult =
  | { status: "invalid"; input: string }
  | { status: "not-in-snapshot"; wallet: Hex }
  | { status: "ok"; wallet: Hex; bits: number[]; bitsHex: Hex; verdict: boolean; margin: number; root: Hex;
      rootSource: "on chain" | "published file"; localVerdict: boolean; source: "X Layer eth_call" | "in-browser (demo)" };

export async function checkWallet(input: string): Promise<CheckResult> {
  const wallet = checksum(input);
  if (!wallet) return { status: "invalid", input };
  const [idx, sh] = await Promise.all([snapshotIndex(), shardOf(wallet)]);
  const entry = sh.wallets[wallet.toLowerCase()];
  if (!entry) return { status: "not-in-snapshot", wallet };
  let { root, depth, count } = idx;
  if (LIVE) {
    const c = await (await live()).readCampaign();
    if (c.invalid) throw new Error("This campaign was invalidated on chain: its snapshot lists a wallet twice.");
    root = c.vectorsRoot; depth = c.vectorsDepth; count = c.vectorsCount;
  }
  if (!inSnapshot(wallet, entry, root, depth, count))
    throw new Error(LIVE ? "This wallet's proof doesn't match the snapshot root stored on chain. Please report it."
                         : "This wallet's proof doesn't match the published snapshot root. Reload the page; if it persists, please report it.");
  const bits = unpack(entry.bits), local = decide(await loadNet(), bits);
  const base = { status: "ok" as const, wallet, bits, bitsHex: entry.bits, root, localVerdict: local.verdict };
  if (!LIVE) return { ...base, ...local, rootSource: "published file", source: "in-browser (demo)" };
  const v = await (await live()).verdictOf(entry.index, wallet, entry.bits, entry.proof);
  return { ...base, ...v, rootSource: "on chain", source: "X Layer eth_call" };
}

// ------------------------------------------------------------------ audit

export type Round = { id: number; status: "none" | "pending" | "ready" | "done" | "expired"; correct: number; total: number; requester?: Hex };
export type AuditInfo = { k: number; testRoot: Hex; testSize: number; openRound: number; rounds: Round[];
  netlistHash?: Hex; committedHash?: Hex; bound?: boolean; invalid?: boolean; leavesMatch: boolean };

const DEMO_KEY = "cusity:demo-rounds";
const demoRounds = (): Round[] => { try { return JSON.parse(sessionStorage.getItem(DEMO_KEY) ?? "[]"); } catch { return []; } };

/** Live: the test rows the site publishes must rebuild to the root committed on chain, or nobody can audit. */
export async function auditInfo(): Promise<AuditInfo> {
  const t = await testLeaves(), rebuilt = rebuildTestRoot(t);
  if (!LIVE) return { k: CONFIG.auditK, testRoot: t.root, testSize: t.size, openRound: -1, rounds: demoRounds(),
    leavesMatch: rebuilt.toLowerCase() === card.testRoot.toLowerCase() };
  const s = await (await live()).auditState();
  return { ...s, k: s.k, rounds: s.rounds, leavesMatch: rebuilt.toLowerCase() === s.testRoot.toLowerCase() };
}

/** One audit round. Demo: K rows picked by a random seed, the shipped circuit scores them in the browser.
 *  Live: request (or join the open round), wait for its block, finalize from the visitor's wallet. */
export async function runAudit(log: (s: string) => void): Promise<Round> {
  const t = await testLeaves();
  if (!LIVE) {
    if (rebuildTestRoot(t).toLowerCase() !== card.testRoot.toLowerCase()) throw new Error("The published test rows don't rebuild to the committed root.");
    const n = await loadNet(), seed = crypto.getRandomValues(new Uint8Array(32)), past = demoRounds(), id = past.length, k = CONFIG.auditK;
    let correct = 0;
    for (let j = 0; j < k; j++) {
      const h = keccak256(concat([toHex(seed), encodePacked(["uint256", "uint256"], [BigInt(id), BigInt(j)])]));
      const row = t.leaves[Number(BigInt(h) % BigInt(t.size))];
      // the leaf is rebuilt from the row itself, so the bits and label scored are the ones committed
      if (!verify(row.proof, t.root, t.depth, row.index, testLeaf(row.index, row.wallet, row.bits, row.label === 1))) throw new Error(`test row ${row.index}: bad proof`);
      const ok = decide(n, unpack(row.bits)).verdict === (row.label === 1);
      correct += ok ? 1 : 0;
      log(`row ${row.index}: labelled ${row.label ? "bot" : "human"}, circuit ${ok ? "agrees" : "disagrees"}`);
    }
    const r: Round = { id, status: "done", correct, total: k };
    sessionStorage.setItem(DEMO_KEY, JSON.stringify([r, ...past]));
    return r;
  }
  const L = await live();
  try {
    const s = await L.auditState();
    if (rebuildTestRoot(t).toLowerCase() !== s.testRoot.toLowerCase()) throw new Error("The published test rows don't rebuild to the root committed on chain.");
    const { wallet, account } = await L.connect();
    let roundId: bigint;
    const open = s.rounds.find(r => r.id === s.openRound && (r.status === "pending" || r.status === "ready"));
    if (open) { roundId = BigInt(open.id); log(`joining open round #${open.id}`); }
    else {
      log("1/2 requestAudit: the next block's hash will pick the rows");
      const rc = await L.mined(await wallet.writeContract({ account, address: CONFIG.audit, abi: L.auditAbi, functionName: "requestAudit", args: [s.modelId] }));
      const [ev] = L.parseEventLogs({ abi: L.auditAbi, logs: rc.logs, eventName: "AuditRequested" });
      if (!ev) throw new Error("The audit request emitted no event.");
      roundId = ev.args.roundId;
    }
    const deadline = Date.now() + 90_000;
    let st = 1;
    while ((st = await L.client.readContract({ address: CONFIG.audit, abi: L.auditAbi, functionName: "status", args: [roundId] })) === 1) {
      if (Date.now() > deadline) throw new Error("The round's block didn't arrive within 90 s. Try again in a minute.");
      await new Promise(r => setTimeout(r, 1500));
    }
    if (st !== 2) throw new Error(`Round #${roundId} is ${L.STATUS[st]}, not ready.`);
    const idx = await L.client.readContract({ address: CONFIG.audit, abi: L.auditAbi, functionName: "sampleIndices", args: [roundId] });
    log(`rows picked: ${idx.join(", ")}`);
    const rows = idx.map(i => ({ index: i, wallet: t.leaves[i].wallet, bits: t.leaves[i].bits, label: t.leaves[i].label === 1 }));
    log("2/2 finalizeAudit: the contract checks each row's proof and runs the circuit on chain");
    await L.mined(await wallet.writeContract({ account, address: CONFIG.audit, abi: L.auditAbi, functionName: "finalizeAudit",
      args: [roundId, rows, idx.map(i => t.leaves[i].proof)] }));
    const r = await L.client.readContract({ address: CONFIG.audit, abi: L.auditAbi, functionName: "rounds", args: [roundId] });
    return { id: Number(roundId), status: "done", correct: r[5], total: r[6], requester: r[1] };
  } catch (e) { throw new Error(L.explain(e)); }
}
