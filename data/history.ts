// Builds per-wallet histories and population-independent counts from the block index.
import type { Tx } from "./indexer";
import { loadTxs } from "./indexer";

export type { Tx };

export const DAY = 86_400;
export const HUB_TXS = 1000;   // a funder/collector with more value txs than this is exchange-scale: a hub, not an owner

export type History = {
  txsOf(address: string): Tx[];            // sorted, both directions
  funderOf(address: string): string | null; // sender of the first incoming value transfer in range
  funderCount(funder: string): number;      // distinct wallets the funder ever sent value to (FUNDER_CAP if exchange-scale)
  /** v2: other wallets the same funder sent value to within 24 h of funding this one (0 when the funder is a hub). */
  funderBurst(address: string): number;
  /** Exchange-scale funder (more than HUB_TXS outgoing txs): links nobody, as in the Arbitrum/LayerZero hunts. */
  funderIsHub(address: string): boolean;
  /** Exchange-scale collector (more than HUB_TXS incoming txs). */
  collectorIsHub(address: string): boolean;
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

export const FUNDER_CAP = 501;

/** The same definitions as the OKX backend (history_okx.ts), computed over every tx in the scanned range.
 *  The one difference: without code lookups, "contract" means "ever called with data". The backend in use
 *  is part of the hashed extractor config, so training and a campaign can't silently mix the two. */
export function buildHistory(txs: Tx[]): History {
  const by = new Map<string, Tx[]>(), first = new Map<string, Tx>(), recipients = new Map<string, Set<string>>();
  const senders = new Map<string, Set<string>>(), outN = new Map<string, number>(), inN = new Map<string, number>(), called = new Set<string>();
  const add = (a: string, t: Tx) => { const l = by.get(a); l ? l.push(t) : by.set(a, [t]); };
  const set = (m: Map<string, Set<string>>, k: string) => m.get(k) ?? m.set(k, new Set()).get(k)!;
  for (const t of txs) {
    add(t.from, t); if (t.to && t.to !== t.from) add(t.to, t);
    outN.set(t.from, (outN.get(t.from) ?? 0) + 1);
    if (t.to) inN.set(t.to, (inN.get(t.to) ?? 0) + 1);
    if (t.to && t.hasData) called.add(t.to);
    if (t.to && t.value > 0n) {
      if (!first.has(t.to)) first.set(t.to, t);
      set(recipients, t.from).add(t.to); set(senders, t.to).add(t.from);
    }
  }
  const funderIsHub = (x: string) => (outN.get(x) ?? 0) > HUB_TXS;
  const h: History = {
    txsOf: a => by.get(a.toLowerCase()) ?? [],
    funderOf: a => first.get(a.toLowerCase())?.from ?? null,
    funderCount: f => funderIsHub(f) ? FUNDER_CAP : Math.min(recipients.get(f)?.size ?? 0, FUNDER_CAP),
    funderIsHub,
    collectorIsHub: x => (inN.get(x) ?? 0) > HUB_TXS,
    funderBurst: a0 => {
      const a = a0.toLowerCase(), f = first.get(a);
      return !f || funderIsHub(f.from) ? 0 : burstAround(by.get(f.from) ?? [], f.from, a, f.time);
    },
    collectorOf: a0 => { const a = a0.toLowerCase(); return mainRecipient(a, by.get(a) ?? [], t => called.has(t.to!)); },
    collectorCount: c => senders.get(c)?.size ?? 0,
  };
  return h;
}

export const historyFromIndex = (fromBlock: number, toBlock: number) => buildHistory(loadTxs(fromBlock, toBlock));
