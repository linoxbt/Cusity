// Wallet history from the OKX X Layer Data API (Onchain OS, formerly OKLink's explorer API):
// one paged request per wallet instead of scanning blocks.
//   GET https://web3.okx.com/api/v5/xlayer/address/normal-transaction-list   (max 50 rows/page)
// Docs: https://web3.okx.com/onchainos/dev-docs/xlayer/developer/data/normal-transactions-by-address
// Note: this endpoint covers about one year back from the wallet's latest transaction.
//
// Auth: create a project and API key at https://web3.okx.com/onchainos/dev-portal, then set
// OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE (e.g. in .env, run with `npx tsx --env-file=.env ...`).
// Every request is signed: base64(HMAC-SHA256(timestamp + "GET" + path?query, secret)).
// Raw pages are cached in data/raw/okx/ so reruns are identical and cheap.
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseUnits } from "viem";
import type { Tx } from "./indexer";
import { burstAround, mainRecipient, HUB_TXS, type History } from "./history";

const HOST = "https://web3.okx.com";
const PATH = "/api/v5/xlayer/address/normal-transaction-list";
const CHAIN = "XLAYER";
const DIR = "data/raw/okx";
const LIMIT = 50;           // the API's maximum rows per page
const MAX_PAGES = 200;      // 10,000 txs per wallet; beyond that a wallet is an exchange/bot-scale sender anyway
export const FUNDER_CAP = 501;   // funder counts above the top threshold (500) are all the same bit

type Item = Record<string, string | undefined>;
type Fetch = (url: string, init?: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** OK-ACCESS-* headers for a GET request. */
export function signHeaders(pathWithQuery: string, env = process.env, now = new Date()): Record<string, string> {
  const key = env.OKX_API_KEY, secret = env.OKX_SECRET_KEY, pass = env.OKX_PASSPHRASE;
  if (!key || !secret || !pass) throw new Error("set OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE (see data/history_okx.ts)");
  const ts = now.toISOString();
  const sign = createHmac("sha256", secret).update(ts + "GET" + pathWithQuery).digest("base64");
  return { "OK-ACCESS-KEY": key, "OK-ACCESS-SIGN": sign, "OK-ACCESS-PASSPHRASE": pass, "OK-ACCESS-TIMESTAMP": ts };
}

const flag = (v: unknown) => v === true || v === "true";
const units = (s: string | undefined) => { try { return s ? parseUnits(s, 18) : 0n; } catch { return 0n; } };

/** API row -> our Tx. normal-transaction-list carries gasPrice/gasLimit; if a row lacks them, the fee stands in. */
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
    toContract: flag(it.isToContract), fromContract: flag(it.isFromContract),
  };
}

export async function fetchTxs(address: string, toBlock: number, fetchFn: Fetch = fetch as unknown as Fetch,
  opts: { fromOnly?: boolean; toOnly?: boolean; maxPages?: number } = {}): Promise<{ txs: Tx[]; capped: boolean }> {
  const dir = opts.fromOnly ? "from" : opts.toOnly ? "to" : "both";
  const a = address.toLowerCase(), cache = `${DIR}/${a}${dir === "both" ? "" : "." + dir}.json`, maxPages = opts.maxPages ?? MAX_PAGES;
  let items: Item[];
  let capped = false;
  if (existsSync(cache)) ({ items, capped } = JSON.parse(readFileSync(cache, "utf8")));
  else {
    items = [];
    for (let page = 1, tries = 0; page <= maxPages; page++) {
      const pq = `${PATH}?chainShortName=${CHAIN}&address=${a}${dir === "both" ? "" : "&isFromOrTo=" + dir}&endBlockHeight=${toBlock}&limit=${LIMIT}&page=${page}`;
      const r = await fetchFn(HOST + pq, { headers: signHeaders(pq) });
      const j = await r.json().catch(() => ({}));
      if ((r.status === 429 || ["50011", "50061", "50013"].includes(String(j.code))) && tries++ < 8) {   // rate limited / busy: back off
        await new Promise(s => setTimeout(s, 1000 * 2 ** Math.min(tries, 5))); page--; continue;
      }
      tries = 0;
      if (!r.ok || String(j.code) !== "0") throw new Error(`OKX Data API ${r.status} ${j.code}: ${j.msg}`);
      const d = j.data?.[0] ?? {};
      const rows: Item[] = d.transactionLists ?? d.transactionList ?? [];
      items.push(...rows);
      if (page >= Number(d.totalPage ?? 1) || rows.length < LIMIT) break;
      if (page === maxPages) capped = true;
    }
    mkdirSync(DIR, { recursive: true });
    writeFileSync(cache, JSON.stringify({ items, capped }));
  }
  const seen = new Set<string>();
  const txs = items.map(toTx).filter(t => t.block <= toBlock && !seen.has(t.hash) && (seen.add(t.hash), true))
    .sort((x, y) => x.block - y.block || x.hash.localeCompare(y.hash));
  return { txs, capped };
}

/** Prefetch every wallet, its first funder and its main recipient, then answer the History interface synchronously. */
export async function okxHistory(addresses: string[], toBlock: number, fetchFn?: Fetch, log = (_: string) => {}): Promise<History> {
  const by = new Map<string, Tx[]>(), first = new Map<string, Tx | null>(), coll = new Map<string, string | null>();
  const fCount = new Map<string, number>(), fTxs = new Map<string, Tx[]>(), cCount = new Map<string, number>(), hubs = new Set<string>();
  let i = 0;
  for (const a0 of addresses) {
    const a = a0.toLowerCase();
    const { txs } = await fetchTxs(a, toBlock, fetchFn);
    by.set(a, txs);
    const f = txs.find(t => t.to === a && t.value > 0n) ?? null;
    first.set(a, f);
    if (f?.fromContract) hubs.add(f.from);
    coll.set(a, mainRecipient(a, txs, t => !!t.toContract));
    if (++i % 50 === 0) log(`history ${i}/${addresses.length}`);
  }
  // Funder: how many distinct wallets it ever sent value to (population-independent), and when.
  // Outgoing txs only, at most 20 pages (1,000 txs): a funder beyond that is exchange-scale, i.e. a hub.
  const funders = [...new Set([...first.values()].filter(Boolean).map(t => t!.from))];
  let k = 0;
  for (const f of funders) {
    if (++k % 50 === 0) log(`funders ${k}/${funders.length}`);
    const { txs, capped } = await fetchTxs(f, toBlock, fetchFn, { fromOnly: true, maxPages: 20 });
    const n = new Set(txs.filter(t => t.from === f && t.to && t.value > 0n).map(t => t.to)).size;
    fCount.set(f, capped ? FUNDER_CAP : Math.min(n, FUNDER_CAP));
    fTxs.set(f, txs);
    if (capped) hubs.add(f);
  }
  // Collector: how many distinct wallets ever sent value to it. Incoming txs only, same 20-page cap.
  const collectors = [...new Set([...coll.values()].filter(Boolean) as string[])];
  k = 0;
  for (const c of collectors) {
    if (++k % 50 === 0) log(`collectors ${k}/${collectors.length}`);
    const { txs, capped } = await fetchTxs(c, toBlock, fetchFn, { toOnly: true, maxPages: 20 });
    cCount.set(c, new Set(txs.filter(t => t.to === c && t.value > 0n).map(t => t.from)).size);
    if (capped || txs.length >= HUB_TXS) hubs.add(c);
  }
  const isHub = (x: string) => hubs.has(x.toLowerCase());
  return {
    txsOf: a => by.get(a.toLowerCase()) ?? [],
    funderOf: a => first.get(a.toLowerCase())?.from ?? null,
    funderCount: f => fCount.get(f) ?? 0,
    isHub,
    funderBurst: a0 => {
      const a = a0.toLowerCase(), f = first.get(a);
      return !f || isHub(f.from) ? 0 : burstAround(fTxs.get(f.from) ?? [], f.from, a, f.time);
    },
    collectorOf: a => coll.get(a.toLowerCase()) ?? null,
    collectorCount: c => cCount.get(c) ?? 0,
  };
}
