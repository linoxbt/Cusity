// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PositionalMerkle
/// @notice A Merkle tree whose leaves sit at fixed positions: leaf i is at position i, the path direction
/// comes from the bits of i, and the depth is committed. Unlike a sorted-pair tree, a proof binds a leaf
/// to its index, so one index cannot carry two leaves. Empty positions hold bytes32(0).
///   node = keccak256(left ‖ right), 64-byte preimage; leaves are hashed by the caller from 32-33 bytes.
library PositionalMerkle {
    /// The smallest depth that holds `count` leaves: 2^(depth-1) < count <= 2^depth (depth 0 holds 1).
    function canonical(uint8 depth, uint256 count) internal pure returns (bool) {
        if (depth > 32 || count == 0 || count > (uint256(1) << depth)) return false;
        return depth == 0 || count > (uint256(1) << (depth - 1));
    }

    function verify(bytes32[] calldata proof, bytes32 root, uint8 depth, uint256 index, bytes32 leaf)
        internal pure returns (bool)
    {
        if (proof.length != depth || index >> depth != 0) return false;
        bytes32 h = leaf;
        for (uint256 k; k < depth; ++k) {
            h = (index >> k) & 1 == 0 ? keccak256(abi.encodePacked(h, proof[k])) : keccak256(abi.encodePacked(proof[k], h));
        }
        return h == root;
    }
}
