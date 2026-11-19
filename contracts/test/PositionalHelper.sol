// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Builds positional Merkle trees (as PositionalMerkle.sol verifies and data/merkle_core.ts builds) for tests.
library PositionalHelper {
    function depthFor(uint256 n) internal pure returns (uint8 d) { while ((uint256(1) << d) < n) ++d; }

    function _pad(bytes32[] memory leaves) private pure returns (bytes32[] memory lvl) {
        lvl = new bytes32[](uint256(1) << depthFor(leaves.length));
        for (uint256 i; i < leaves.length; ++i) lvl[i] = leaves[i];
    }

    function _up(bytes32[] memory lvl) private pure returns (bytes32[] memory up) {
        up = new bytes32[](lvl.length / 2);
        for (uint256 i; i < up.length; ++i) up[i] = keccak256(abi.encodePacked(lvl[2 * i], lvl[2 * i + 1]));
    }

    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory lvl = _pad(leaves);
        while (lvl.length > 1) lvl = _up(lvl);
        return lvl[0];
    }

    function proof(bytes32[] memory leaves, uint256 idx) internal pure returns (bytes32[] memory p) {
        uint8 depth = depthFor(leaves.length);
        p = new bytes32[](depth);
        bytes32[] memory lvl = _pad(leaves);
        for (uint256 d; d < depth; ++d) { p[d] = lvl[idx ^ 1]; lvl = _up(lvl); idx >>= 1; }
    }
}
