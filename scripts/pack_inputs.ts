// Bundles every input the extractor read for a snapshot, so anyone can recompute every wallet's bits offline
// (audit H-3): the OKX history pages (only the fields the extractor reads; all public X Layer transactions,
// each checkable by its hash on any RPC), the raw state reads and the snapshot block header.
//   npx tsx scripts/pack_inputs.ts <block> [out=web/public/snapshot/inputs.json.gz]
// Verify with: scripts/verify_snapshot.sh <inputs.json.gz> web/public/snapshot/list.json
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const block = process.argv[2], out = process.argv[3] ?? "web/public/snapshot/inputs.json.gz";
if (!block) { console.error("usage: pack_inputs.ts <block> [out]"); process.exit(1); }
const KEEP = ["txId", "txid", "hash", "height", "blockHeight", "transactionTime", "blockTime", "from", "to", "amount", "value",
  "gasPrice", "gasLimit", "txFee", "methodId", "isToContract", "isFromContract", "state"];
const okxDir = `data/raw/okx/${block}`, stDir = `data/raw/state/${block}`;
const okx: Record<string, unknown> = {}, state: Record<string, unknown> = {};
for (const f of readdirSync(okxDir).sort()) {
  const j = JSON.parse(readFileSync(`${okxDir}/${f}`, "utf8"));
  okx[f] = { capped: j.capped, items: j.items.map((it: Record<string, unknown>) => Object.fromEntries(KEEP.filter(k => k in it).map(k => [k, it[k]]))) };
}
for (const f of readdirSync(`${stDir}/raw`).sort()) state[f] = JSON.parse(readFileSync(`${stDir}/raw/${f}`, "utf8"));
const header = existsSync(`${stDir}/block.json`) ? JSON.parse(readFileSync(`${stDir}/block.json`, "utf8")) : null;
const buf = gzipSync(Buffer.from(JSON.stringify({ block: Number(block), header, okx, state })), { level: 9 });
writeFileSync(out, buf);
// the digest travels with the snapshot, so a copy fetched from anywhere (GitHub, a mirror) can be checked
writeFileSync(out.replace(/inputs\.json\.gz$/, "inputs.sha256.txt"), createHash("sha256").update(buf).digest("hex") + "  inputs.json.gz\n");
console.log(`${Object.keys(okx).length} history files + ${Object.keys(state).length} state reads -> ${out} (${(buf.length / 1e6).toFixed(1)} MB, sha256 ${createHash("sha256").update(buf).digest("hex").slice(0, 16)}…)`);
