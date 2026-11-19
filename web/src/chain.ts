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
      const L = await live();
      const n = await L.boundNetlist().catch(e => { throw new Error(L.explain(e)); });
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
  const L = LIVE ? await live() : undefined;
  if (L) {
    const c = await L.readCampaign().catch(e => { throw new Error(L.explain(e)); });
    if (!c.bound) throw new Error("The campaign isn't bound to a model yet: verdicts open once it is.");
    if (c.invalid) throw new Error("This campaign was invalidated on chain: its snapshot lists a wallet twice.");
    root = c.vectorsRoot; depth = c.vectorsDepth; count = c.vectorsCount;
  }
  if (!inSnapshot(wallet, entry, root, depth, count))
    throw new Error(LIVE ? "This wallet's proof doesn't match the snapshot root stored on chain. Please report it."
                         : "This wallet's proof doesn't match the published snapshot root. Reload the page; if it persists, please report it.");
  const bits = unpack(entry.bits), local = decide(await loadNet(), bits);
  const base = { status: "ok" as const, wallet, bits, bitsHex: entry.bits, root, localVerdict: local.verdict };
  if (!LIVE) return { ...base, ...local, rootSource: "published file", source: "in-browser (demo)" };
  const v = await L!.verdictOf(entry.index, wallet, entry.bits, entry.proof).catch(e => { throw new Error(L!.explain(e)); });
  return { ...base, ...v, rootSource: "on chain", source: "X Layer eth_call" };
}

// ------------------------------------------------------------------ audit

export type Round = { id: number; status: "none" | "pending" | "ready" | "done" | "expired" | "void"; correct: number; total: number; scored?: number; requester?: Hex };
export type AuditInfo = { k: number; testRoot: Hex; testSize: number; openRound: number; rounds: Round[];
  netlistHash?: Hex; committedHash?: Hex; bound?: boolean; invalid?: boolean; leavesMatch: boolean;
  testOwner?: Hex; modelOwner?: Hex; testVoid?: boolean };

const DEMO_KEY = "cusity:demo-rounds";
const demoRounds = (): Round[] => { try { return JSON.parse(sessionStorage.getItem(DEMO_KEY) ?? "[]"); } catch { return []; } };

/** The published rows must rebuild the committed root AND number exactly the committed size (a commit that
 *  overstates its size could otherwise freeze audits: anyone can void it on chain with proveEmptyRow). */
const leavesMatch = (t: Awaited<ReturnType<typeof testLeaves>>, root: string, size: number) =>
  t.leaves.length === size && t.size === size && rebuildTestRoot(t).toLowerCase() === root.toLowerCase();

export async function auditInfo(): Promise<AuditInfo> {
  const t = await testLeaves();
  if (!LIVE) return { k: CONFIG.auditK, testRoot: t.root, testSize: t.size, openRound: -1, rounds: demoRounds(),
    leavesMatch: leavesMatch(t, card.testRoot, card.testSize) };
  const L = await live();
  const s = await L.auditState().catch(e => { throw new Error(L.explain(e)); });
  return { ...s, leavesMatch: leavesMatch(t, s.testRoot, s.testSize) };
}

/** One audit round. Demo: K rows picked by a random seed, the shipped circuit scores them in the browser.
 *  Live: request (or join the open round), wait for its block, finalize from the visitor's wallet. */
export async function runAudit(log: (s: string) => void): Promise<Round> {
  const t = await testLeaves();
  if (!LIVE) {
    if (!leavesMatch(t, card.testRoot, card.testSize)) throw new Error("The published test rows don't rebuild the committed root and size.");
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
    if (s.testVoid) throw new Error("This model's test set was voided on chain; it can't be audited.");
    if (!leavesMatch(t, s.testRoot, s.testSize)) throw new Error("The published test rows don't match the root and size committed on chain.");
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
    // 0 (none) can come from a fallback RPC that hasn't seen the request yet: keep waiting
    while ((st = await L.client.readContract({ address: CONFIG.audit, abi: L.auditAbi, functionName: "status", args: [roundId] })) <= 1) {
      if (Date.now() > deadline) throw new Error("The round's block didn't arrive within 90 s. Try again in a minute.");
      await new Promise(r => setTimeout(r, 1500));
    }
    if (st !== 2) throw new Error(`Round #${roundId} is ${L.STATUS[st]}, not ready.`);
    const idx = await L.client.readContract({ address: CONFIG.audit, abi: L.auditAbi, functionName: "sampleIndices", args: [roundId] });
    log(`rows picked: ${idx.join(", ")}`);
    const rows = idx.map(i => ({ index: i, wallet: t.leaves[i].wallet, bits: t.leaves[i].bits, label: t.leaves[i].label === 1 }));
    // resume where an earlier (maybe interrupted) finalize left off; 4 rows per transaction (~11M gas)
    let done = (await L.client.readContract({ address: CONFIG.audit, abi: L.auditAbi, functionName: "rounds", args: [roundId] }))[7];
    while (done < rows.length) {
      const end = Math.min(done + 4, rows.length);
      log(`2/2 finalizeAudit rows ${done + 1}–${end} of ${rows.length}: proofs checked and the circuit run on chain`);
      await L.mined(await wallet.writeContract({ account, address: CONFIG.audit, abi: L.auditAbi, functionName: "finalizeAudit",
        args: [roundId, rows.slice(done, end), idx.slice(done, end).map(i => t.leaves[i].proof)] }));
      done = end;
    }
    const r = await L.client.readContract({ address: CONFIG.audit, abi: L.auditAbi, functionName: "rounds", args: [roundId] });
    return { id: Number(roundId), status: "done", correct: r[5], total: r[6], requester: r[1] };
  } catch (e) { throw new Error(L.explain(e)); }
}
