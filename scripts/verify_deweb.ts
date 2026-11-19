// Read every file of a published DeWEB site back from X Layer's SiteRegistry and compare its sha256 with the
// build manifest (what TapeKit does for every visitor).   npx tsx scripts/verify_deweb.ts <container> [build/deweb]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, type Hex } from "viem";
const [container, dir = "build/deweb"] = process.argv.slice(2) as [Hex, string];
const reg = "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6" as const;
const abi = parseAbi(["function read(address, string) view returns (bytes)", "function pathCount(address) view returns (uint256)"]);
const pc = createPublicClient({ transport: http(process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech", { retryCount: 3 }) });
const files = JSON.parse(readFileSync(`${dir}/.manifest.json`, "utf8")).files as { path: string; sha256: string; size: number }[];
let ok = 0;
for (const f of files) {
  const b = await pc.readContract({ address: reg, abi, functionName: "read", args: [container, f.path] });
  const h = "0x" + createHash("sha256").update(Buffer.from(b.slice(2), "hex")).digest("hex");
  if (h === f.sha256.toLowerCase()) ok++; else console.log(`MISMATCH ${f.path}`);
}
const n = await pc.readContract({ address: reg, abi, functionName: "pathCount", args: [container] });
console.log(`${ok}/${files.length} files on chain match the build; ${n} paths in the container`);
process.exit(ok === files.length && Number(n) === files.length ? 0 : 1);
