// How many wallets from a published list are active on X Layer? Read-only: one eth_getTransactionCount each.
//   npx tsx scripts/sybil_overlap.ts <file: one address per line, or CSV with address first> [sampleSize=1000]
import { readFileSync } from "node:fs";
import { client } from "../data/chain";

const [file, n = "1000"] = process.argv.slice(2);
const all = readFileSync(file, "utf8").trim().split("\n").map(l => l.split(",")[0].trim())
  .filter(a => /^0x[0-9a-fA-F]{40}$/.test(a)) as `0x${string}`[];
const step = Math.max(1, Math.floor(all.length / Number(n)));
const sample = all.filter((_, i) => i % step === 0).slice(0, Number(n));   // deterministic sample

let on = 0;
for (let i = 0; i < sample.length; i += 25) {
  const r = await Promise.all(sample.slice(i, i + 25).map(a => client.getTransactionCount({ address: a }).catch(() => -1)));
  on += r.filter(x => x > 0).length;
}
console.log({ listSize: all.length, checked: sample.length, activeOnXLayer: on,
  rate: `${(100 * on / sample.length).toFixed(2)}%`, projected: Math.round(on / sample.length * all.length) });
