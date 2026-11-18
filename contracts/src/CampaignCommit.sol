// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {CusityRegistry, IAuditCommits} from "./CusityRegistry.sol";

/// @title CampaignCommit
/// @notice Proves a campaign's filter was fixed before its snapshot and that every wallet's input
/// bits were fixed at the snapshot. Order: commit (before snapshot) -> publishVectors (after) ->
/// tape out + register -> bind (hashes must match).
contract CampaignCommit {
    struct Campaign {
        address owner;
        bytes32 netlistHash;
        bytes32 extractorHash;
        uint64 snapshotBlock;
        uint64 commitBlock;
        bytes32 vectorsRoot;   // leaf = keccak256(abi.encodePacked(wallet, bits))
        string vectorsURI;
        uint256 modelId;
        bool bound;
    }

    CusityRegistry public immutable registry;
    Campaign[] private _campaigns;

    event Committed(uint256 indexed id, address indexed owner, bytes32 netlistHash, bytes32 extractorHash, uint64 snapshotBlock);
    event VectorsPublished(uint256 indexed id, bytes32 root, string uri);
    event Bound(uint256 indexed id, uint256 indexed modelId);

    error SnapshotPassed();
    error NotOwner();
    error BeforeSnapshot();
    error AlreadyPublished();
    error AlreadyBound();
    error NetlistMismatch();
    error ExtractorMismatch();
    error TestSetAfterCommit();
    error NotReady();
    error NotInSnapshot();

    constructor(address registry_) { registry = CusityRegistry(registry_); }

    function commit(bytes32 netlistHash, bytes32 extractorHash, uint64 snapshotBlock) external returns (uint256 id) {
        if (snapshotBlock <= block.number) revert SnapshotPassed();
        id = _campaigns.length;
        Campaign storage c = _campaigns.push();
        c.owner = msg.sender; c.netlistHash = netlistHash; c.extractorHash = extractorHash;
        c.snapshotBlock = snapshotBlock; c.commitBlock = uint64(block.number);
        emit Committed(id, msg.sender, netlistHash, extractorHash, snapshotBlock);
    }

    function publishVectors(uint256 id, bytes32 root, string calldata uri) external {
        Campaign storage c = _campaigns[id];
        if (msg.sender != c.owner) revert NotOwner();
        if (block.number <= c.snapshotBlock) revert BeforeSnapshot();
        if (c.vectorsRoot != bytes32(0)) revert AlreadyPublished();
        c.vectorsRoot = root; c.vectorsURI = uri;
        emit VectorsPublished(id, root, uri);
    }

    function bind(uint256 id, uint256 modelId) external {
        Campaign storage c = _campaigns[id];
        if (msg.sender != c.owner) revert NotOwner();
        if (c.bound) revert AlreadyBound();
        CusityRegistry.Model memory m = registry.model(modelId);
        if (m.netlistHash != c.netlistHash) revert NetlistMismatch();
        if (m.extractorHash != c.extractorHash) revert ExtractorMismatch();
        // The model's test set must have been fixed before this campaign's commit (review 2.6).
        (, uint64 tBlock) = IAuditCommits(address(registry.audit())).testCommitInfo(m.testCommitId);
        if (tBlock >= c.commitBlock) revert TestSetAfterCommit();
        c.modelId = modelId; c.bound = true;
        emit Bound(id, modelId);
    }

    function campaign(uint256 id) external view returns (Campaign memory) { return _campaigns[id]; }
    function campaignCount() external view returns (uint256) { return _campaigns.length; }

    function verdictOf(uint256 id, address wallet, bytes8 bits, bytes32[] calldata proof)
        external view returns (bool verdict, uint8 margin)
    {
        Campaign storage c = _campaigns[id];
        if (!c.bound || c.vectorsRoot == bytes32(0)) revert NotReady();
        if (!MerkleProof.verifyCalldata(proof, c.vectorsRoot, keccak256(abi.encodePacked(wallet, bits)))) revert NotInSnapshot();
        return registry.check(c.modelId, bits);
    }
}
