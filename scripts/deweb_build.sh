#!/usr/bin/env bash
# Build the site for DeWEB (TapeOut's on-chain web: files stored in a circuit's container via SiteRegistry).
# DeWEB stores files up to 8.4 MB with a fixed set of content types, so four files stay off chain and are linked
# from GitHub: the 8.8 MB extractor inputs bundle (its sha256 ships on chain), cusity.v, sitemap.xml, robots.txt.
# Writes build/deweb/ and build/deweb/.manifest.json (path, content type, size, sha256) for Publish.s.sol.
#   scripts/deweb_build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VITE_OFFCHAIN_BASE="https://raw.githubusercontent.com/linoxbt/cusity/$(git rev-parse HEAD)/web/public/" npm run -w web build >/dev/null
rm -rf build/deweb && cp -r web/dist build/deweb
find build/deweb -name "*.map" -delete
rm -f build/deweb/snapshot/inputs.json.gz build/deweb/model/cusity.v build/deweb/sitemap.xml build/deweb/robots.txt
node --input-type=module -e '
import { createHash } from "node:crypto"; import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"; import { join, relative, sep, extname } from "node:path";
const T = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml",
  png: "image/png", ico: "image/x-icon", woff2: "font/woff2", txt: "text/plain; charset=utf-8" };
const root = "build/deweb", files = [];
const walk = d => { for (const n of readdirSync(d).sort()) { const f = join(d, n); if (statSync(f).isDirectory()) { walk(f); continue; }
  const path = relative(root, f).split(sep).join("/"); if (path.startsWith(".")) continue;
  const ct = T[extname(n).slice(1).toLowerCase()]; if (!ct) throw new Error("no DeWEB content type for " + path);
  const b = readFileSync(f); if (b.length > 8_400_000) throw new Error(path + " is over 8.4 MB");
  files.push({ path, contentType: ct, size: b.length, sha256: "0x" + createHash("sha256").update(b).digest("hex") }); } };
walk(root);
writeFileSync(join(root, ".manifest.json"), JSON.stringify({ files }));
const bytes = files.reduce((s, f) => s + f.size, 0), chunks = files.reduce((s, f) => s + Math.max(1, Math.ceil(f.size / 24000)), 0);
console.log(`build/deweb: ${files.length} files, ${(bytes / 1e6).toFixed(2)} MB, ${chunks} chunk transactions`);'
