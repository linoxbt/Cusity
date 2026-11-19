// Inverse of pack_inputs.ts: writes the bundle into data/raw/ of the current checkout (used by verify_snapshot.sh).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const b = JSON.parse(gunzipSync(readFileSync(process.argv[2])).toString());
const okxDir = `data/raw/okx/${b.block}`, stDir = `data/raw/state/${b.block}`;
mkdirSync(okxDir, { recursive: true }); mkdirSync(`${stDir}/raw`, { recursive: true });
for (const [f, v] of Object.entries(b.okx)) writeFileSync(`${okxDir}/${f}`, JSON.stringify(v));
for (const [f, v] of Object.entries(b.state)) writeFileSync(`${stDir}/raw/${f}`, JSON.stringify(v));
if (b.header) writeFileSync(`${stDir}/block.json`, JSON.stringify(b.header));
console.log(`block ${b.block}: ${Object.keys(b.okx).length} histories, ${Object.keys(b.state).length} state reads unpacked`);
