// Split build/snapshot_vectors.json into 256 small shards keyed by the address's first byte, so a check
// downloads a few KB instead of the whole file. Also writes list.json: every [wallet, bits] in tree order,
// which is the campaign's published vectorsURI; anyone (and the site's Step 04 page) can rebuild the root
// from it and check it is sorted and duplicate-free. Shards and index.json carry the root, so a mixed
// old/new cache is detected.
//   npx tsx scripts/shard_snapshot.ts build/snapshot_vectors.json web/public/snapshot
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error("usage: shard_snapshot.ts <snapshot_vectors.json> <outDir>"); process.exit(1); }
const s = JSON.parse(readFileSync(src, "utf8"));
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith(".json")) rmSync(`${out}/${f}`);
const shards: Record<string, Record<string, unknown>> = {};
for (const [w, v] of Object.entries(s.wallets)) (shards[w.slice(2, 4)] ??= {})[w] = v;
for (let i = 0; i < 256; i++) {
  const k = i.toString(16).padStart(2, "0");
  writeFileSync(`${out}/${k}.json`, JSON.stringify({ root: s.root, wallets: shards[k] ?? {} }));
}
writeFileSync(`${out}/list.json`, JSON.stringify({ root: s.root, depth: s.depth, count: s.count, list: s.list }));
const all: string[] = s.list.map((x: [string, string]) => x[0]);
const samples = [0, 1, 2, 3, 4, 5, 6, 7].map(i => all[Math.floor((i * all.length) / 8)]);
writeFileSync(`${out}/index.json`, JSON.stringify({ campaignId: s.campaignId, block: s.block, extractorHash: s.extractorHash,
  root: s.root, depth: s.depth, count: s.count, samples }));
console.log(`${all.length} wallets -> 256 shards + list.json in ${out}; root ${s.root}`);
