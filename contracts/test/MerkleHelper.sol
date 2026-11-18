// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

/// Builds a sorted-pair Merkle tree (what MerkleProof and the OpenZeppelin JS merkle-tree library use) over a
/// power-of-two leaf count, for tests.
library MerkleHelper {
    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory lvl = leaves;
        while (lvl.length > 1) {
            bytes32[] memory up = new bytes32[](lvl.length / 2);
            for (uint256 i; i < up.length; ++i) up[i] = Hashes.commutativeKeccak256(lvl[2 * i], lvl[2 * i + 1]);
            lvl = up;
        }
        return lvl[0];
    }

    function proof(bytes32[] memory leaves, uint256 idx) internal pure returns (bytes32[] memory p) {
        uint256 depth; for (uint256 n = leaves.length; n > 1; n /= 2) ++depth;
        p = new bytes32[](depth);
        bytes32[] memory lvl = leaves;
        for (uint256 d; d < depth; ++d) {
            p[d] = lvl[idx ^ 1];
            bytes32[] memory up = new bytes32[](lvl.length / 2);
            for (uint256 i; i < up.length; ++i) up[i] = Hashes.commutativeKeccak256(lvl[2 * i], lvl[2 * i + 1]);
            lvl = up; idx /= 2;
        }
    }
}
