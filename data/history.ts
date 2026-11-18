// Builds per-wallet histories and population-independent counts from the block index.
import type { Tx } from "./indexer";
import { loadTxs } from "./indexer";

export type { Tx };

export const DAY = 86_400;
export const HUB_TXS = 1000;   // a funder/collector with more value txs than this is exchange-scale: a hub, not an owner

export type History = {
  txsOf(address: string): Tx[];            // sorted, both directions
  funderOf(address: string): string | null; // sender of the first incoming value transfer in range
  funderCount(funder: string): number;      // how many wallets in the WHOLE scanned range share this first funder
  /** v2: other wallets the same funder sent value to within 24 h of funding this one (0 when the funder is a hub). */
  funderBurst(address: string): number;
  /** v2: exchange-scale address or contract: links nobody (Arbitrum and LayerZero removed these before clustering). */
  isHub(address: string): boolean;
  /** v2: the non-contract address this wallet sent the most value to, or null. */
  collectorOf(address: string): string | null;
  /** v2: distinct wallets that ever sent value to this address. */
  collectorCount(collector: string): number;
};

/** Main recipient: most value sent to a non-contract address (ties: lowest address). */
export function mainRecipient(a: string, txs: Tx[], isContract: (t: Tx) => boolean): string | null {
  const sum = new Map<string, bigint>();
  for (const t of txs) if (t.from === a && t.to && t.to !== a && t.value > 0n && !isContract(t)) sum.set(t.to, (sum.get(t.to) ?? 0n) + t.value);
  let best: string | null = null, v = -1n;
  for (const [k, x] of [...sum].sort((p, q) => p[0].localeCompare(q[0]))) if (x > v) { best = k; v = x; }
  return best;
}

/** Recipients of `funder` (other than `a`) paid within 24 h of time t. */
export function burstAround(funderTxs: Tx[], funder: string, a: string, t: number): number {
  return new Set(funderTxs.filter(x => x.from === funder && x.to && x.to !== a && x.value > 0n && Math.abs(x.time - t) <= DAY).map(x => x.to)).size;
}

export function buildHistory(txs: Tx[]): History {
  const by = new Map<string, Tx[]>(), first = new Map<string, Tx>(), counts = new Map<string, number>();
  const senders = new Map<string, Set<string>>(), valueTxs = new Map<string, number>(), called = new Set<string>();
  const add = (a: string, t: Tx) => { const l = by.get(a); l ? l.push(t) : by.set(a, [t]); };
  for (const t of txs) {
    add(t.from, t); if (t.to && t.to !== t.from) add(t.to, t);
    if (t.to && t.hasData) called.add(t.to);              // no code lookups here: anything ever called counts as a contract
    if (t.to && t.value > 0n) {
      if (!first.has(t.to)) { first.set(t.to, t); counts.set(t.from, (counts.get(t.from) ?? 0) + 1); }
      (senders.get(t.to) ?? senders.set(t.to, new Set()).get(t.to)!).add(t.from);
      valueTxs.set(t.from, (valueTxs.get(t.from) ?? 0) + 1); valueTxs.set(t.to, (valueTxs.get(t.to) ?? 0) + 1);
    }
  }
  const isHub = (x: string) => called.has(x) || (valueTxs.get(x) ?? 0) > HUB_TXS;
  const h: History = {
    txsOf: a => by.get(a.toLowerCase()) ?? [],
    funderOf: a => first.get(a.toLowerCase())?.from ?? null,
    funderCount: f => counts.get(f) ?? 0,
    isHub,
    funderBurst: a0 => {
      const a = a0.toLowerCase(), f = first.get(a);
      return !f || isHub(f.from) ? 0 : burstAround(by.get(f.from) ?? [], f.from, a, f.time);
    },
    collectorOf: a0 => { const a = a0.toLowerCase(); return mainRecipient(a, by.get(a) ?? [], t => called.has(t.to!)); },
    collectorCount: c => senders.get(c)?.size ?? 0,
  };
  return h;
}

export const historyFromIndex = (fromBlock: number, toBlock: number) => buildHistory(loadTxs(fromBlock, toBlock));
