// Writes web/public/third-party-licenses.txt: the licence of every package bundled into the site, plus the fonts.
//   npx tsx scripts/third_party_licenses.ts
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
const PKGS = ["viem", "ox", "abitype", "@noble/curves", "@noble/hashes", "@scure/base", "@scure/bip32", "@scure/bip39", "lenis",
  "d3-force", "d3-dispatch", "d3-quadtree", "d3-timer"];
const out: string[] = ["Third-party software and fonts shipped with the Cusity site.\n"];
for (const name of PKGS) {
  const dir = `node_modules/${name}`;
  if (!existsSync(dir)) continue;
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  const lic = readdirSync(dir).find(f => /^licen[cs]e/i.test(f));
  out.push(`${"=".repeat(72)}\n${name} ${pkg.version} (${pkg.license})\n${"=".repeat(72)}\n${lic ? readFileSync(`${dir}/${lic}`, "utf8").trim() : `License: ${pkg.license}`}\n`);
}
out.push(`${"=".repeat(72)}\nFonts: Space Grotesk, JetBrains Mono (SIL Open Font License 1.1)\n${"=".repeat(72)}\n${readFileSync("web/src/fonts/OFL.txt", "utf8").trim()}\n`);
writeFileSync("web/public/third-party-licenses.txt", out.join("\n"));
console.log(`${out.length - 2} packages + fonts -> web/public/third-party-licenses.txt`);
