// Light data layer, shared by every page: fetching with retries, the sharded snapshot, the test set and the
// cluster graph. No RPC client here (that lives in live.ts and is loaded only when needed).
import { getAddress, type Hex } from "viem";
import { CONFIG } from "./config";
import { build, snapshotLeaf, testLeaf, verify } from "../../data/merkle_core";

export class FetchError extends Error {}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** GET JSON with up to 3 tries. Throws a readable FetchError (never a raw JSON parse error). */
export async function getJson<T>(url: string, fresh = false): Promise<T> {
  let last = "";
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { cache: fresh ? "no-cache" : "default" });
      if (r.status === 404) throw new FetchError("not found");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json() as T;
    } catch (e) {
      if (e instanceof FetchError) throw new FetchError(`${url.split("/").pop()?.split("?")[0]} was not found.`);
      last = (e as Error).message;
      if (i < 2) await sleep(400 * 2 ** i);
    }
  }
  throw new FetchError(`Couldn't load ${url.split("/").pop()?.split("?")[0]} (${last}). Check your connection and try again.`);
}

/** A cached promise that is forgotten if it fails, so the next call really retries. */
function memo<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) { p = load(); cache.set(key, p); p.catch(() => cache.delete(key)); }
  return p;
}

// ------------------------------------------------------------------ snapshot

export type SnapIndex = { campaignId: number; block: number; root: Hex; depth: number; count: number; extractorHash: Hex; samples: string[] };
export type SnapEntry = { index: number; bits: Hex; proof: Hex[] };
type Shard = { root: Hex; wallets: Record<string, SnapEntry> };

const idxCache = new Map<string, Promise<SnapIndex>>(), shardCache = new Map<string, Promise<Shard>>();
/** index.json is always revalidated; shards are fetched under the root they belong to, so a browser can never
 *  mix an old cached shard with a new index (the shard's own root is checked as well). */
export const snapshotIndex = () => memo(idxCache, "i", () => getJson<SnapIndex>(`${CONFIG.snapshotUrl}index.json`, true));
export async function shardOf(wallet: string): Promise<Shard> {
  const idx = await snapshotIndex(), k = wallet.slice(2, 4).toLowerCase();
  const s = await memo(shardCache, `${idx.root}:${k}`, () => getJson<Shard>(`${CONFIG.snapshotUrl}${k}.json?r=${idx.root.slice(2, 14)}`));
  if (s.root.toLowerCase() !== idx.root.toLowerCase()) {
    shardCache.delete(`${idx.root}:${k}`);
    throw new FetchError("The snapshot is being updated. Reload the page in a minute.");
  }
  return s;
}
export const sampleWallets = async () => (await snapshotIndex()).samples;
export const snapshotList = () => getJson<{ root: Hex; depth: number; count: number; list: [string, Hex][] }>(`${CONFIG.snapshotUrl}list.json`, true);

/** Does this entry sit at its index in a tree with this root? (index < count, positional proof) */
export function inSnapshot(wallet: Hex, e: SnapEntry, root: Hex, depth: number, count: number) {
  return e.index < count && verify(e.proof, root, depth, e.index, snapshotLeaf(e.index, wallet, e.bits));
}

export const checksum = (input: string): Hex | undefined => { try { return getAddress(input.trim()); } catch { return undefined; } };

// ------------------------------------------------------------------ test set

export type TestLeaves = { root: Hex; depth: number; size: number;
  leaves: { index: number; wallet: Hex; bits: Hex; label: number; leaf: Hex; proof: Hex[] }[] };
const tlCache = new Map<string, Promise<TestLeaves>>();
export const testLeaves = () => memo(tlCache, "t", () => getJson<TestLeaves>(CONFIG.testLeavesUrl, true));

/** Rebuilds the whole tree from the published rows (catches a swapped label, a missing or extra row). */
export function rebuildTestRoot(t: TestLeaves): Hex {
  return build(t.leaves.map((l, i) => {
    if (l.index !== i) throw new Error(`test row ${i} is out of order`);
    return testLeaf(i, l.wallet, l.bits, l.label === 1);
  })).root;
}

// ------------------------------------------------------------------ cluster graph

export type GNodeData = { id: string; kind: string; label?: number; src?: string; v?: number; m?: number };
export type GEdgeData = { s: string; t: string; k: string; okb?: number; n?: number };
export type ClusterStats = { id: number; size: number; bots: number; flagged: number; funders: number; collectors: number; direct: number; window24h: number };
export type Cluster = { stats: ClusterStats; nodes: GNodeData[]; edges: GEdgeData[] };
type Rate = { n: number; botRate: number; ci95: [number, number] };
export type GIndex = { wallets: Record<string, number>; clusters: ClusterStats[]; hubDegree: number; evidence?: { inCluster: Rate; notClustered: Rate } };
const gCache = new Map<string, Promise<unknown>>();
export const graphIndex = () => memo(gCache as Map<string, Promise<GIndex>>, "i", () => getJson<GIndex>("./graph/index.json", true));
export const clusterById = (id: number) => memo(gCache as Map<string, Promise<Cluster>>, `c${id}`, () => getJson<Cluster>(`./graph/c/${id}.json`));
