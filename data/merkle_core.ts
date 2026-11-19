// Positional Merkle trees, shared by the pipeline (Node) and the site (browser). Must match
// contracts/src/PositionalMerkle.sol: leaf i sits at position i, the path direction comes from the bits
// of i, empty positions hold bytes32(0), node = keccak256(left ‖ right), depth = smallest that fits.
// Unlike a sorted-pair tree, a proof binds a leaf to its index (audit S2/S3).
import { encodePacked, keccak256, concat, type Hex } from "viem";

export const ZERO_LEAF = `0x${"0".repeat(64)}` as Hex;
export const ZERO_ADDRESS = `0x${"0".repeat(40)}` as Hex;

/** test leaf = keccak256(abi.encodePacked(uint32 index, address wallet, bytes8 bits, bool label)) */
export const testLeaf = (i: number, wallet: Hex, bits: Hex, label: boolean) =>
  keccak256(encodePacked(["uint32", "address", "bytes8", "bool"], [i, wallet, bits, label]));
/** snapshot leaf = keccak256(abi.encodePacked(uint32 index, address wallet, bytes8 bits)), wallets sorted by address */
export const snapshotLeaf = (i: number, wallet: Hex, bits: Hex) =>
  keccak256(encodePacked(["uint32", "address", "bytes8"], [i, wallet, bits]));

export function depthFor(count: number): number {
  if (count < 1) throw new Error("empty tree");
  let d = 0; while ((1 << d) < count) d++;
  return d;
}

/** All levels, bottom (padded leaves) to top (root). */
export function build(leaves: Hex[]): { root: Hex; depth: number; levels: Hex[][] } {
  const depth = depthFor(leaves.length);
  let lvl = [...leaves, ...Array((1 << depth) - leaves.length).fill(ZERO_LEAF)] as Hex[];
  const levels = [lvl];
  while (lvl.length > 1) {
    const up: Hex[] = [];
    for (let i = 0; i < lvl.length; i += 2) up.push(keccak256(concat([lvl[i], lvl[i + 1]])));
    levels.push(lvl = up);
  }
  return { root: lvl[0], depth, levels };
}

export const proofOf = (levels: Hex[][], index: number): Hex[] =>
  levels.slice(0, -1).map((lvl, k) => lvl[(index >> k) ^ 1]);

export function rootFrom(leaf: Hex, index: number, proof: Hex[]): Hex {
  let h = leaf;
  proof.forEach((p, k) => { h = ((index >> k) & 1) === 0 ? keccak256(concat([h, p])) : keccak256(concat([p, h])); });
  return h;
}

export const verify = (proof: Hex[], root: Hex, depth: number, index: number, leaf: Hex) =>
  proof.length === depth && index >= 0 && index < 2 ** depth && rootFrom(leaf, index, proof).toLowerCase() === root.toLowerCase();
