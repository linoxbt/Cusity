// A wallet at a fixed snapshot block -> 64 bits. Deterministic: same index, config and block give the
// same bits for the same wallet, whoever else is in the input file (funder counts come from the
// whole scanned range, not from the input list).
//
//   npx tsx data/extract.ts --wallets data/labels.csv --block 76300000 --out data/vectors.jsonl
//
// Needs: the block index covering [scanFromBlock, block] (data/indexer.ts), and an RPC that serves
// state at `block` (an archive node once the block is more than ~128 blocks old).
import { erc20Abi, getAddress } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { client } from "./chain";
import { toBits, pack, type RawFeatures } from "./features";
import { historyFromIndex, type History } from "./history";

export type Config = { chainId: number; scanFromBlock: number; windowStart: number; windowEnd: number;
  okbUsd: number; usdt0: `0x${string}`; usdt0Decimals: number; exchanges: string[] };

export const loadConfig = (p = "data/extractor.config.json"): Config => JSON.parse(readFileSync(p, "utf8"));

const pct = (n: number, d: number) => (d === 0 ? 0 : (100 * n) / d);
const counts = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());

/** History-only features (pure; unit-testable). */
export function historyFeatures(addr: string, h: History, cfg: Config, snapshotTime: number): RawFeatures {
  const a = addr.toLowerCase(), txs = h.txsOf(a), out = txs.filter(t => t.from === a);
  const funder = h.funderOf(a), exchanges = new Set(cfg.exchanges.map(x => x.toLowerCase()));
  const valueCounts = counts(out.map(t => t.value.toString()));
  const gasCounts = counts(out.map(t => `${t.gasPrice}:${t.gasLimit}`));
  return {
    ageDays: txs.length ? (snapshotTime - txs[0].time) / 86400 : 0,
    contracts: new Set(out.filter(t => t.hasData && t.to).map(t => t.to)).size,
    counterparties: new Set([...out.map(t => t.to), ...txs.filter(t => t.to === a).map(t => t.from)].filter(x => x && x !== a)).size,
    funderCluster: funder ? h.funderCount(funder) : 0,
    amountRepeat: pct(out.filter(t => (valueCounts.get(t.value.toString()) ?? 0) > 1).length, out.length),
    hourSpread: new Set(out.map(t => new Date(t.time * 1000).getUTCHours())).size,
    gasSame: pct(Math.max(0, ...gasCounts.values()), out.length),
    burstShare: pct(txs.filter(t => t.time >= cfg.windowStart && t.time <= cfg.windowEnd).length, txs.length),
    hasName: false, // no name-service lookup in v1
    fundedFromExchange: !!funder && exchanges.has(funder),
    sweptToFunder: !!funder && out.some(t => t.to === funder),
  };
}

/** State at the snapshot block, read over RPC. */
export async function stateFeatures(addr: string, block: bigint, cfg: Config): Promise<RawFeatures> {
  const A = getAddress(addr);
  const [nonce, okbWei, usdt, code] = await Promise.all([
    client.getTransactionCount({ address: A, blockNumber: block }),
    client.getBalance({ address: A, blockNumber: block }),
    client.readContract({ address: cfg.usdt0, abi: erc20Abi, functionName: "balanceOf", args: [A], blockNumber: block }),
    client.getCode({ address: A, blockNumber: block }),
  ]);
  return {
    txCount: nonce,
    balanceUsd: (Number(okbWei) / 1e18) * cfg.okbUsd + Number(usdt) / 10 ** cfg.usdt0Decimals,
    isContract: !!code && code !== "0x",
  };
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
  const { timestamp } = await client.getBlock({ blockNumber: block });
  const h = historyFromIndex(cfg.scanFromBlock, Number(block));
  const lines: string[] = [];
  for (const w of readWallets(arg("wallets")!)) {
    const f = { ...historyFeatures(w.address, h, cfg, Number(timestamp)), ...(await stateFeatures(w.address, block, cfg)) };
    lines.push(JSON.stringify({ address: w.address, bits: pack(toBits(f)), ...(w.label !== undefined ? { label: w.label } : {}), block: Number(block) }));
  }
  writeFileSync(arg("out")!, lines.join("\n") + "\n");
  console.log(`wrote ${lines.length} vectors at block ${block}`);
}
if (process.argv[1]?.endsWith("extract.ts")) main().catch(e => { console.error(e); process.exit(1); });
