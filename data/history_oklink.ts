// Wallet history from OKLink's explorer API: one paged request per wallet instead of scanning blocks.
// The API key is injected by the session's network proxy (header Ok-Access-Key); none is stored here.
// Raw pages are cached in data/raw/oklink/ so reruns are identical and cheap.
//
// VERIFY on first use: `npx tsx scripts/oklink_probe.ts <address>` prints a raw response. Field names
// below follow OKLink's v5 explorer API; the mapper tolerates the variants we know of.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseUnits } from "viem";
import type { Tx } from "./indexer";
import type { History } from "./history";

const BASE = process.env.OKLINK_BASE ?? "https://www.oklink.com/api/v5/explorer";
const CHAIN = "XLAYER";
const DIR = "data/raw/oklink";
const LIMIT = 100;          // rows per page
const MAX_PAGES = 100;      // 10,000 txs per wallet; beyond that a wallet is an exchange/bot-scale sender anyway
export const FUNDER_CAP = 501;   // funder counts above the top threshold (500) are all the same bit

type Item = Record<string, string | undefined>;
type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

const units = (s: string | undefined) => { try { return s ? parseUnits(s, 18) : 0n; } catch { return 0n; } };

/** OKLink row -> our Tx. Without per-tx gas fields, the fee stands in for "gas settings" (gasSame). */
export function toTx(it: Item): Tx {
  const ms = Number(it.transactionTime ?? it.blockTime ?? 0);
  return {
    hash: String(it.txId ?? it.txid ?? it.hash),
    block: Number(it.height ?? it.blockHeight),
    time: Math.floor(ms > 1e12 ? ms / 1000 : ms),
    from: String(it.from ?? "").toLowerCase(),
    to: it.to ? String(it.to).toLowerCase() : null,
    value: units(it.amount ?? it.value),
    gasPrice: it.gasPrice !== undefined ? BigInt(it.gasPrice) : units(it.txFee),
    gasLimit: it.gasLimit !== undefined ? BigInt(it.gasLimit) : 0n,
    hasData: !!it.methodId && it.methodId !== "0x" && it.methodId !== "0x00000000",
  };
}

export async function fetchTxs(address: string, toBlock: number, fetchFn: Fetch = fetch as unknown as Fetch): Promise<{ txs: Tx[]; capped: boolean }> {
  const a = address.toLowerCase(), cache = `${DIR}/${a}.json`;
  let items: Item[];
  let capped = false;
  if (existsSync(cache)) ({ items, capped } = JSON.parse(readFileSync(cache, "utf8")));
  else {
    items = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${BASE}/address/transaction-list?chainShortName=${CHAIN}&address=${a}&protocolType=transaction&limit=${LIMIT}&page=${page}`;
      const r = await fetchFn(url);
      if (r.status === 429) { await new Promise(s => setTimeout(s, 1500)); page--; continue; }
      const j = await r.json();
      if (!r.ok || String(j.code) !== "0") throw new Error(`OKLink ${r.status} ${j.code}: ${j.msg}`);
      const d = j.data?.[0] ?? {};
      const rows: Item[] = d.transactionLists ?? d.transactionList ?? [];
      items.push(...rows);
      if (page >= Number(d.totalPage ?? 1) || rows.length < LIMIT) break;
      if (page === MAX_PAGES) capped = true;
    }
    mkdirSync(DIR, { recursive: true });
    writeFileSync(cache, JSON.stringify({ items, capped }));
  }
  const seen = new Set<string>();
  const txs = items.map(toTx).filter(t => t.block <= toBlock && !seen.has(t.hash) && (seen.add(t.hash), true))
    .sort((x, y) => x.block - y.block || x.hash.localeCompare(y.hash));
  return { txs, capped };
}

/** Prefetch every wallet and its first funder, then answer the History interface synchronously. */
export async function oklinkHistory(addresses: string[], toBlock: number, fetchFn?: Fetch, log = (_: string) => {}): Promise<History> {
  const by = new Map<string, Tx[]>(), funder = new Map<string, string | null>(), fCount = new Map<string, number>();
  let i = 0;
  for (const a0 of addresses) {
    const a = a0.toLowerCase();
    const { txs } = await fetchTxs(a, toBlock, fetchFn);
    by.set(a, txs);
    const first = txs.find(t => t.to === a && t.value > 0n);
    funder.set(a, first ? first.from : null);
    if (++i % 50 === 0) log(`history ${i}/${addresses.length}`);
  }
  // Funder cluster: how many distinct wallets the funder ever sent value to (population-independent).
  for (const f of new Set([...funder.values()].filter(Boolean) as string[])) {
    const { txs, capped } = await fetchTxs(f, toBlock, fetchFn);
    const n = new Set(txs.filter(t => t.from === f && t.to && t.value > 0n).map(t => t.to)).size;
    fCount.set(f, capped ? FUNDER_CAP : Math.min(n, FUNDER_CAP));
  }
  return {
    txsOf: a => by.get(a.toLowerCase()) ?? [],
    funderOf: a => funder.get(a.toLowerCase()) ?? null,
    funderCount: f => fCount.get(f) ?? 0,
  };
}
