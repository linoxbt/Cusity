// Split a snapshot_vectors.json into 256 small shards keyed by the address's first byte, so a
// check downloads ~8 KB instead of the whole file. The Merkle root is unchanged (same proofs).
//   npx tsx scripts/shard_snapshot.ts web/public/snapshot_vectors.json web/public/snapshot
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const [src, out] = process.argv.slice(2);
const s = JSON.parse(readFileSync(src, "utf8"));
mkdirSync(out, { recursive: true });
const shards: Record<string, Record<string, unknown>> = {};
for (const [w, v] of Object.entries(s.wallets)) (shards[w.slice(2, 4)] ??= {})[w] = v;
for (let i = 0; i < 256; i++) { const k = i.toString(16).padStart(2, "0"); writeFileSync(`${out}/${k}.json`, JSON.stringify(shards[k] ?? {})); }
const all = Object.keys(s.wallets);
const samples = [0, 1, 2, 3, 4, 5, 6, 7].map(i => all[Math.floor((i * all.length) / 8)]);
writeFileSync(`${out}/index.json`, JSON.stringify({ campaignId: s.campaignId, block: s.block, extractorHash: s.extractorHash, root: s.root, count: all.length, samples }));
console.log(`${all.length} wallets -> 256 shards in ${out}; root ${s.root}`);
