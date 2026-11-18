// Merkle trees that OpenZeppelin's MerkleProof accepts (sorted pairs).
//   npx tsx data/merkle.ts test data/test.jsonl [out=data/test_leaves.json]
//   npx tsx data/merkle.ts snapshot build/snapshot.jsonl <campaignId> [out=build/snapshot_vectors.json]
// Test leaf:     keccak256(abi.encodePacked(uint32 index, bytes8 bits, bool label))   13 bytes
// Snapshot leaf: keccak256(abi.encodePacked(address wallet, bytes8 bits))            28 bytes
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { encodePacked, keccak256 } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { extractorHash } from "./extractor_hash";

type Hex = `0x${string}`;
const read = (f: string) => readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l));

export const testLeaf = (i: number, bits: Hex, label: boolean) => keccak256(encodePacked(["uint32", "bytes8", "bool"], [i, bits, label]));
export const snapshotLeaf = (wallet: Hex, bits: Hex) => keccak256(encodePacked(["address", "bytes8"], [wallet, bits]));

export function testTree(rows: { bits: Hex; label: number }[]) {
  const leaves = rows.map((r, i) => testLeaf(i, r.bits, r.label === 1));
  const tree = SimpleMerkleTree.of(leaves);
  return { root: tree.root as Hex, size: rows.length,
    leaves: rows.map((r, i) => ({ index: i, bits: r.bits, label: r.label, leaf: leaves[i], proof: tree.getProof(i) })) };
}

export function snapshotTree(rows: { address: Hex; bits: Hex; block: number }[], campaignId: number, extHash: Hex) {
  const leaves = rows.map(r => snapshotLeaf(r.address, r.bits));
  const tree = SimpleMerkleTree.of(leaves);
  return { campaignId, block: rows[0]?.block, extractorHash: extHash, root: tree.root as Hex,
    wallets: Object.fromEntries(rows.map((r, i) => [r.address.toLowerCase(), { bits: r.bits, proof: tree.getProof(i) }])) };
}

if (process.argv[1]?.endsWith("merkle.ts")) {
  const [mode, file, a3, a4] = process.argv.slice(2);
  if (mode === "test") {
    const out = a3 ?? "data/test_leaves.json", t = testTree(read(file));
    writeFileSync(out, JSON.stringify(t)); console.log(`test root ${t.root} size ${t.size} -> ${out}`);
  } else if (mode === "snapshot") {
    const out = a4 ?? "build/snapshot_vectors.json", t = snapshotTree(read(file), Number(a3), extractorHash());
    writeFileSync(out, JSON.stringify(t)); console.log(`snapshot root ${t.root} wallets ${Object.keys(t.wallets).length} -> ${out}`);
  } else { console.error("usage: merkle.ts test <file> | snapshot <file> <campaignId>"); process.exit(1); }
}
