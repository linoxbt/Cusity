// extractorHash = sha256 over the extractor sources AND its config (thresholds, window, OKB price,
// exchange list, scan range). Anything that changes the bits is in here, so it can't change after the
// campaign commit without the hash changing (review 2.2).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const EXTRACTOR_FILES = ["data/chain.ts", "data/extract.ts", "data/extractor.config.json",
  "data/features.ts", "data/history.ts", "data/history_okx.ts", "data/indexer.ts"];

export function extractorHash(files = EXTRACTOR_FILES): `0x${string}` {
  const h = createHash("sha256");
  for (const f of [...files].sort()) { h.update(f); h.update("\0"); h.update(readFileSync(f)); h.update("\0"); }
  return `0x${h.digest("hex")}`;
}

if (process.argv[1]?.endsWith("extractor_hash.ts")) console.log(extractorHash());
