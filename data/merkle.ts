// Test-set and snapshot trees for AccuracyAudit and CampaignCommit (positional, see merkle_core.ts).
//   npx tsx data/merkle.ts test data/test.jsonl [out=data/test_leaves.json]
//   npx tsx data/merkle.ts snapshot data/vectors.jsonl <campaignId> [out=build/snapshot_vectors.json]
import { readFileSync, writeFileSync } from "node:fs";
import { getAddress, type Hex } from "viem";
import { extractorHash } from "./extractor_hash";
import { build, proofOf, snapshotLeaf, testLeaf, ZERO_ADDRESS } from "./merkle_core";

const read = (f: string) => readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l));
const addr = (a: string | null | undefined) => (a ? getAddress(a) : ZERO_ADDRESS) as Hex;

/** Rows keep their file order: index i = row i. Each leaf names its wallet, so labels can be checked
 *  against the public Sybil lists and bits recomputed with the extractor. */
export function testTree(rows: { address?: string | null; bits: Hex; label: number }[]) {
  const leaves = rows.map((r, i) => testLeaf(i, addr(r.address), r.bits, r.label === 1));
  const { root, depth, levels } = build(leaves);
  return { root, depth, size: rows.length,
    leaves: rows.map((r, i) => ({ index: i, wallet: addr(r.address), bits: r.bits, label: r.label, leaf: leaves[i], proof: proofOf(levels, i) })) };
}

/** Wallets sorted by address (strictly increasing, so duplicates are impossible in an honest file). */
export function snapshotTree(rows: { address: string; bits: Hex; block: number; extractorHash?: Hex }[], campaignId: number, extHash: Hex) {
  // every row must come from one block and one extractor, and that extractor is the one the index records
  const blocks = new Set(rows.map(r => r.block)), exts = new Set(rows.map(r => (r.extractorHash ?? extHash).toLowerCase()));
  if (blocks.size !== 1) throw new Error(`rows come from ${blocks.size} different blocks`);
  if (exts.size !== 1) throw new Error(`rows were extracted by ${exts.size} different extractors`);
  extHash = [...exts][0] as Hex;
  const sorted = rows.map(r => ({ ...r, address: r.address.toLowerCase() })).sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  sorted.forEach((r, i) => { if (i && r.address === sorted[i - 1].address) throw new Error(`duplicate wallet ${r.address}`); });
  const leaves = sorted.map((r, i) => snapshotLeaf(i, addr(r.address), r.bits));
  const { root, depth, levels } = build(leaves);
  return { campaignId, block: sorted[0]?.block, extractorHash: extHash, root, depth, count: sorted.length,
    wallets: Object.fromEntries(sorted.map((r, i) => [r.address, { index: i, bits: r.bits, proof: proofOf(levels, i) }])),
    list: sorted.map(r => [r.address, r.bits]) as [string, Hex][] };
}

if (process.argv[1]?.endsWith("merkle.ts")) {
  const [mode, file, a3, a4] = process.argv.slice(2);
  if (mode === "test") {
    const out = a3 ?? "data/test_leaves.json", t = testTree(read(file));
    writeFileSync(out, JSON.stringify(t)); console.log(`test root ${t.root} size ${t.size} depth ${t.depth} -> ${out}`);
  } else if (mode === "snapshot") {
    const out = a4 ?? "build/snapshot_vectors.json", t = snapshotTree(read(file), Number(a3), extractorHash());
    writeFileSync(out, JSON.stringify(t)); console.log(`snapshot root ${t.root} wallets ${t.count} depth ${t.depth} -> ${out}`);
  } else { console.error("usage: merkle.ts test <file> | snapshot <file> <campaignId>"); process.exit(1); }
}
