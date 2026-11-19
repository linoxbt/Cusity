// A wallet at a fixed snapshot block -> 64 bits. Deterministic: the same history data, config and block
// give the same bits for the same wallet, whoever else is in the input file (funder and collector counts
// come from those addresses' own histories, not from the input list).
//
//   npx tsx --env-file=.env data/extract.ts --wallets data/labels_public.csv --block 76254000 --out data/vectors.jsonl
//
// The history backend is part of the hashed config (extractor.config.json "history"): "okx" reads the
// OKX X Layer Data API (needs OKX_* keys), "index" reads our own block index (data/indexer.ts). State at
// `block` is read over RPC (an archive node once the block is more than ~128 blocks old).
import { erc20Abi, getAddress } from "viem";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { client } from "./chain";
import { toBits, pack, type RawFeatures } from "./features";
import { historyFromIndex, type History } from "./history";
import { okxHistory } from "./history_okx";
import { extractorHash } from "./extractor_hash";

export type Config = { chainId: number; history: "okx" | "index"; scanFromBlock: number; windowDays: number;
  okbUsd: number; usdt0: `0x${string}`; usdt0Decimals: number; exchanges: string[] };

export const loadConfig = (p = "data/extractor.config.json"): Config => JSON.parse(readFileSync(p, "utf8"));

export const GAS_MIN_TXS = 3;
const pct = (n: number, d: number) => (d === 0 ? 0 : (100 * n) / d);
const counts = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());

/** History-only features (pure; unit-testable). */
export function historyFeatures(addr: string, h: History, cfg: Config, snapshotTime: number): RawFeatures {
  const a = addr.toLowerCase(), txs = h.txsOf(a), out = txs.filter(t => t.from === a);
  const funder = h.funderOf(a), exchanges = new Set(cfg.exchanges.map(x => x.toLowerCase()));
  const paid = out.filter(t => t.value > 0n);   // value transfers only: zero-value calls all "repeat" 0 (audit B13)
  const valueCounts = counts(paid.map(t => t.value.toString()));
  const gasCounts = counts(out.map(t => `${t.gasPrice}:${t.gasLimit}`));
  return {
    ageDays: txs.length ? (snapshotTime - txs[0].time) / 86400 : 0,
    contracts: new Set(out.filter(t => t.to && (t.toContract ?? t.hasData)).map(t => t.to)).size,   // OKX knows; the index uses "called with data"
    counterparties: new Set([...out.map(t => t.to), ...txs.filter(t => t.to === a).map(t => t.from)].filter(x => x && x !== a)).size,
    funderCluster: funder ? h.funderCount(funder) : 0,
    amountRepeat: pct(paid.filter(t => (valueCounts.get(t.value.toString()) ?? 0) > 1).length, paid.length),
    hourSpread: new Set(out.map(t => new Date(t.time * 1000).getUTCHours())).size,
    gasSame: out.length >= GAS_MIN_TXS ? pct(Math.max(0, ...gasCounts.values()), out.length) : 0,   // 1-2 txs always "match"
    burstShare: pct(txs.filter(t => t.time > snapshotTime - cfg.windowDays * 86400 && t.time <= snapshotTime).length, txs.length),
    funderBurst: h.funderBurst(a),
    collectorShared: (() => { const c = h.collectorOf(a); return c && !h.collectorIsHub(c) ? Math.max(0, h.collectorCount(c) - 1) : 0; })(),
    fundedFromHub: !!funder && (exchanges.has(funder) || h.funderIsHub(funder)),
    sweptToFunder: !!funder && out.some(t => t.to === funder && t.value > 0n),
  };
}

export type RawState = { nonce: number; okbWei: string; usdt: string; code: string };

/** Raw archive reads at the snapshot block, cached as read (never derived values), so a change to the
 *  feature rules always applies on the next run (audit: a cache of derived values hid a fix). */
export async function readState(addr: string, block: bigint, cfg: Config): Promise<RawState> {
  const A = getAddress(addr), cache = `data/raw/state/${block}/raw/${addr.toLowerCase()}.json`;
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const [nonce, okbWei, usdt, code] = await Promise.all([
    client.getTransactionCount({ address: A, blockNumber: block }),
    client.getBalance({ address: A, blockNumber: block }),
    client.readContract({ address: cfg.usdt0, abi: erc20Abi, functionName: "balanceOf", args: [A], blockNumber: block }),
    client.getCode({ address: A, blockNumber: block }),
  ]);
  const r: RawState = { nonce, okbWei: okbWei.toString(), usdt: usdt.toString(), code: code ?? "0x" };
  mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, JSON.stringify(r));
  return r;
}

/** State features, derived from the raw reads every run. */
export function stateFeatures(r: RawState, cfg: Config): RawFeatures {
  return {
    txCount: r.nonce,
    balanceUsd: (Number(BigInt(r.okbWei)) / 1e18) * cfg.okbUsd + Number(BigInt(r.usdt)) / 10 ** cfg.usdt0Decimals,
    // EIP-7702 delegated EOAs carry code 0xef0100‖address but are still wallets
    isContract: r.code !== "0x" && r.code !== "" && !r.code.toLowerCase().startsWith("0xef0100"),
  };
}

/** The snapshot block's timestamp, cached so a rerun needs no network. */
async function blockTime(block: bigint): Promise<number> {
  const cache = `data/raw/state/${block}/block.json`;
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")).timestamp;
  const b = await client.getBlock({ blockNumber: block });
  mkdirSync(dirname(cache), { recursive: true }); writeFileSync(cache, JSON.stringify({ number: Number(b.number), hash: b.hash, timestamp: Number(b.timestamp) }));
  return Number(b.timestamp);
}

export function readWallets(path: string): { address: string; label?: number }[] {
  return readFileSync(path, "utf8").trim().split("\n")
    .map(l => l.split(",").map(s => s.trim().replace(/^"|"$/g, "")))
    .filter(c => /^0x[0-9a-fA-F]{40}$/.test(c[0]))
    .map(c => ({ address: c[0].toLowerCase(), label: c[1] === undefined || c[1] === "" ? undefined : Number(c[1]) }));
}

async function main() {
  const argv = process.argv.slice(2), arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? undefined : argv[i + 1]; };
  const cfg = loadConfig(arg("config"));
  const block = BigInt(arg("block")!);
  const timestamp = await blockTime(block);
  const wallets = readWallets(arg("wallets")!);
  if (arg("history")) throw new Error("the history backend is set in extractor.config.json (\"history\"), so it is part of extractorHash");
  const ext = extractorHash(), raw: string[] = [];
  const h: History = cfg.history === "okx"
    ? await okxHistory(wallets.map(w => w.address), Number(block), undefined, console.log)
    : historyFromIndex(cfg.scanFromBlock, Number(block));
  const lines: string[] = [];
  for (const w of wallets) {
    const f = { ...historyFeatures(w.address, h, cfg, timestamp), ...stateFeatures(await readState(w.address, block, cfg), cfg) };
    lines.push(JSON.stringify({ address: w.address, bits: pack(toBits(f)), ...(w.label !== undefined ? { label: w.label } : {}), block: Number(block), extractorHash: ext }));
    const funder = h.funderOf(w.address);
    raw.push(JSON.stringify({ address: w.address, ...f, funder, funderHub: !!funder && h.funderIsHub(funder) }));
  }
  writeFileSync(arg("out")!, lines.join("\n") + "\n");
  if (arg("raw")) writeFileSync(arg("raw")!, raw.join("\n") + "\n");   // un-thresholded features, for checking thresholds
  console.log(`wrote ${lines.length} vectors at block ${block}`);
}
if (process.argv[1]?.endsWith("extract.ts")) main().catch(e => { console.error(e); process.exit(1); });
