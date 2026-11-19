// Writes build/merkle_compat.json: positional trees built in TypeScript (data/merkle_core.ts) that the
// Solidity tests (contracts/test/Cusity.t.sol, MerkleCompatTest) must accept. Deterministic.
//   npx tsx scripts/merkle_compat.ts
import { writeFileSync } from "node:fs";
import type { Hex } from "viem";
import { testTree, snapshotTree } from "../data/merkle";

const w = (i: number) => `0x${(0x1000 + i * 7919).toString(16).padStart(40, "0")}`;
const bits = (i: number) => `0x${((BigInt(i) * 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn).toString(16).padStart(16, "0")}` as Hex;
const t = testTree(Array.from({ length: 11 }, (_, i) => ({ address: w(i), bits: bits(i), label: i % 3 === 0 ? 1 : 0 })));
const s = snapshotTree(Array.from({ length: 13 }, (_, i) => ({ address: w(12 - i), bits: bits(i + 50), block: 1 })), 0, "0x00");
writeFileSync("build/merkle_compat.json", JSON.stringify({
  test: { root: t.root, depth: t.depth, size: t.size, rows: t.leaves },
  snapshot: { root: s.root, depth: s.depth, count: s.count, rows: s.list.map(([a, b]) => ({ index: s.wallets[a].index, wallet: a, bits: b, proof: s.wallets[a].proof })) },
}, null, 1));
console.log("build/merkle_compat.json: test", t.root, "snapshot", s.root);
