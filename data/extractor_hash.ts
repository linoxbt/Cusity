// extractorHash = sha256 over the extractor sources AND its config (thresholds, window, OKB price,
// exchange list, scan range). Anything that changes the bits is in here, so it can't change after the
// campaign commit without the hash changing (review 2.2).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const EXTRACTOR_FILES = ["data/chain.ts", "data/extract.ts", "data/extractor.config.json",
  "data/features.ts", "data/history.ts", "data/history_okx.ts", "data/indexer.ts"];

/** The viem version decides how amounts are parsed (parseUnits), so it is part of the extractor. */
export const viemVersion = () => JSON.parse(readFileSync("package-lock.json", "utf8")).packages["node_modules/viem"].version as string;

/** Line endings are normalised to LF, so a Windows (CRLF) checkout hashes the same (audit M9). */
export function extractorHash(files = EXTRACTOR_FILES): `0x${string}` {
  const h = createHash("sha256");
  for (const f of [...files].sort()) {
    h.update(f); h.update("\0"); h.update(readFileSync(f, "utf8").replace(/\r\n/g, "\n")); h.update("\0");
  }
  h.update(`viem@${viemVersion()}`);
  return `0x${h.digest("hex")}`;
}

if (process.argv[1]?.endsWith("extractor_hash.ts")) console.log(extractorHash());
