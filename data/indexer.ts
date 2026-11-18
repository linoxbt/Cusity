// Deterministic wallet-history source: scan X Layer blocks [from, to] with eth_getBlockByNumber(full)
// and cache compact transactions to data/raw/blocks/<from>-<to>.jsonl. Same range -> same files.
//
//   npx tsx data/indexer.ts --from 76000000 --to 76100000
//
// Plain RPC cannot list a wallet's history, so this is option (b) in the spec. Wallet age and every
// other history feature only see the scanned range: set scanFromBlock in extractor.config.json to the
// earliest block you index, and keep it fixed for a campaign.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { client } from "./chain";

export type Tx = { hash: string; block: number; time: number; from: string; to: string | null;
  value: bigint; gasPrice: bigint; gasLimit: bigint; hasData: boolean };

const DIR = "data/raw/blocks";
const CHUNK = 1000;

const enc = (t: Tx) => JSON.stringify([t.hash, t.block, t.time, t.from, t.to, t.value.toString(), t.gasPrice.toString(), t.gasLimit.toString(), t.hasData ? 1 : 0]);
const dec = (l: string): Tx => { const a = JSON.parse(l); return { hash: a[0], block: a[1], time: a[2], from: a[3], to: a[4], value: BigInt(a[5]), gasPrice: BigInt(a[6]), gasLimit: BigInt(a[7]), hasData: a[8] === 1 }; };

async function scanChunk(from: number, to: number): Promise<Tx[]> {
  const out: Tx[] = [];
  for (let b = from; b <= to; b += 10) {
    const nums = Array.from({ length: Math.min(10, to - b + 1) }, (_, i) => BigInt(b + i));
    const blocks = await Promise.all(nums.map(n => client.getBlock({ blockNumber: n, includeTransactions: true })));
    for (const blk of blocks) for (const t of blk.transactions) {
      out.push({ hash: t.hash, block: Number(blk.number), time: Number(blk.timestamp), from: t.from.toLowerCase(),
        to: t.to ? t.to.toLowerCase() : null, value: t.value, gasPrice: t.gasPrice ?? t.maxFeePerGas ?? 0n,
        gasLimit: t.gas, hasData: t.input !== "0x" });
    }
  }
  return out;
}

export async function index(from: number, to: number, log = console.log) {
  mkdirSync(DIR, { recursive: true });
  for (let s = Math.floor(from / CHUNK) * CHUNK; s <= to; s += CHUNK) {
    const e = s + CHUNK - 1, f = `${DIR}/${s}-${e}.jsonl`;
    if (existsSync(f)) continue;
    const txs = await scanChunk(s, e);
    writeFileSync(f, txs.map(enc).join("\n") + (txs.length ? "\n" : ""));
    log(`indexed ${s}-${e}: ${txs.length} txs`);
  }
}

/** All cached transactions with fromBlock <= block <= toBlock, sorted by (block, file order). */
export function loadTxs(fromBlock: number, toBlock: number): Tx[] {
  if (!existsSync(DIR)) throw new Error("no index: run data/indexer.ts first");
  const files = readdirSync(DIR).map(n => ({ n, s: Number(n.split("-")[0]), e: Number(n.split("-")[1].split(".")[0]) }))
    .filter(x => x.e >= fromBlock && x.s <= toBlock).sort((a, b) => a.s - b.s);
  const need = Math.floor(fromBlock / CHUNK) * CHUNK;
  for (let s = need; s <= toBlock; s += CHUNK)
    if (!files.some(x => x.s === s)) throw new Error(`index gap: blocks ${s}-${s + CHUNK - 1} not indexed`);
  const txs: Tx[] = [];
  for (const { n } of files) for (const l of readFileSync(`${DIR}/${n}`, "utf8").split("\n")) if (l) {
    const t = dec(l); if (t.block >= fromBlock && t.block <= toBlock) txs.push(t);
  }
  return txs;
}

if (process.argv[1]?.endsWith("indexer.ts")) {
  const argv = process.argv.slice(2), arg = (k: string) => argv[argv.indexOf(`--${k}`) + 1];
  index(Number(arg("from")), Number(arg("to"))).catch(e => { console.error(e); process.exit(1); });
}
