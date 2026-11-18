// Builds per-wallet histories and population-independent funder counts from the block index.
import type { Tx } from "./indexer";
import { loadTxs } from "./indexer";

export type { Tx };

export type History = {
  txsOf(address: string): Tx[];            // sorted, both directions
  funderOf(address: string): string | null; // sender of the first incoming value transfer in range
  funderCount(funder: string): number;      // how many wallets in the WHOLE scanned range share this first funder
};

export function buildHistory(txs: Tx[]): History {
  const by = new Map<string, Tx[]>(), first = new Map<string, string>(), counts = new Map<string, number>();
  const add = (a: string, t: Tx) => { const l = by.get(a); l ? l.push(t) : by.set(a, [t]); };
  for (const t of txs) {
    add(t.from, t); if (t.to && t.to !== t.from) add(t.to, t);
    if (t.to && t.value > 0n && !first.has(t.to)) {
      first.set(t.to, t.from);
      counts.set(t.from, (counts.get(t.from) ?? 0) + 1);
    }
  }
  return {
    txsOf: a => by.get(a.toLowerCase()) ?? [],
    funderOf: a => first.get(a.toLowerCase()) ?? null,
    funderCount: f => counts.get(f) ?? 0,
  };
}

export const historyFromIndex = (fromBlock: number, toBlock: number) => buildHistory(loadTxs(fromBlock, toBlock));
