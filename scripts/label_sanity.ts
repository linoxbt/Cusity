// Do the Plan A labels carry any signal on X Layer, using only what plain RPC gives (no history)?
// Reads nonce, OKB balance, USDT0 balance and code at the latest block for every labelled wallet,
// then reports per-class distributions and how well single thresholds separate the classes.
// Diagnostic only: not training data (history features are missing).
//   npx tsx scripts/label_sanity.ts [data/labels_public.csv]
import { erc20Abi } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { client } from "../data/chain";

const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";
const rows = readFileSync(process.argv[2] ?? "data/labels_public.csv", "utf8").trim().split("\n").slice(1)
  .map(l => l.split(",")).map(c => ({ a: c[0] as `0x${string}`, y: Number(c[1]), src: c[2] }));
const block = await client.getBlockNumber();
type R = { y: number; src: string; nonce: number; okb: number; usdt: number; contract: boolean };
const out: R[] = [];
for (let i = 0; i < rows.length; i += 20) {
  const part = rows.slice(i, i + 20);
  const res = await Promise.all(part.map(async r => {
    try {
      const [n, b, u, c] = await Promise.all([
        client.getTransactionCount({ address: r.a, blockNumber: block }),
        client.getBalance({ address: r.a, blockNumber: block }),
        client.readContract({ address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [r.a], blockNumber: block }),
        client.getCode({ address: r.a, blockNumber: block }),
      ]);
      return { y: r.y, src: r.src, nonce: n, okb: Number(b) / 1e18, usdt: Number(u) / 1e6, contract: !!c && c !== "0x" };
    } catch { return undefined; }
  }));
  out.push(...(res.filter(Boolean) as R[]));
}
writeFileSync("build/tmp/label_sanity.json", JSON.stringify({ block: Number(block), rows: out }));

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const summary = (name: string, f: (r: R) => number) => {
  const b = out.filter(r => r.y === 1).map(f), h = out.filter(r => r.y === 0).map(f);
  // best single threshold (either direction) for balanced accuracy
  let best = { acc: 0.5, t: 0, dir: ">" };
  for (const t of [...new Set([...b, ...h])].sort((x, y) => x - y)) for (const dir of [">", "<="]) {
    const tp = b.filter(v => dir === ">" ? v > t : v <= t).length / b.length, tn = h.filter(v => dir === ">" ? v <= t : v > t).length / h.length;
    if ((tp + tn) / 2 > best.acc) best = { acc: (tp + tn) / 2, t, dir };
  }
  console.log(`${name.padEnd(8)} bot p25/p50/p75 = ${q(b, .25)}/${q(b, .5)}/${q(b, .75)}   human = ${q(h, .25)}/${q(h, .5)}/${q(h, .75)}   best rule: bot if ${name} ${best.dir} ${best.t} -> balanced acc ${(100 * best.acc).toFixed(1)}%`);
};
console.log(`block ${block}: ${out.length} wallets (${out.filter(r => r.y).length} bot, ${out.filter(r => !r.y).length} human)`);
summary("nonce", r => r.nonce);
summary("okb", r => +r.okb.toFixed(4));
summary("usdt0", r => +r.usdt.toFixed(2));
console.log(`contracts: bot ${out.filter(r => r.y && r.contract).length}, human ${out.filter(r => !r.y && r.contract).length}`);
for (const s of ["hop-sybil", "layerzero-sybil", "hop-user"]) { const g = out.filter(r => r.src === s).map(r => r.nonce); console.log(`  ${s.padEnd(16)} n=${g.length} median nonce ${q(g, .5)}`); }
