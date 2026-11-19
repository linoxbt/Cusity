// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CusityRegistry, IAuditCommits} from "./CusityRegistry.sol";
import {PositionalMerkle} from "./PositionalMerkle.sol";

/// @title CampaignCommit
/// @notice Proves a campaign's filter was fixed before its snapshot and that every wallet's input
/// bits were fixed soon after it. Order: commit (at least MIN_LEAD blocks before the snapshot, naming the test
/// set its model must be scored on) -> publishVectors (within PUBLISH_WINDOW after the snapshot) -> tape out +
/// register -> bind (within BIND_WINDOW; netlist, extractor and test set must match). Every campaign an owner
/// commits is listed (campaignsOf), so a campaign can't be quietly swapped for another one later.
///
/// Snapshot vectors are a positional Merkle tree over wallets sorted by address:
///   leaf i = keccak256(abi.encodePacked(uint32 i, address wallet, bytes8 bits))
/// A wallet listed twice (two different bit vectors) can be proven by anyone with proveDuplicate,
/// which permanently invalidates the campaign (audit S3). The site also rebuilds the whole tree from
/// the published file and checks it is sorted and duplicate-free.
contract CampaignCommit {
    uint64 public constant MIN_LEAD = 86_400;          // ~1 day of X Layer blocks (~1 s each)
    uint64 public constant PUBLISH_WINDOW = 604_800;   // ~7 days
    uint64 public constant BIND_WINDOW = 1_209_600;    // ~14 days

    struct Campaign {
        address owner;
        bytes32 netlistHash;
        bytes32 extractorHash;
        uint64 snapshotBlock;
        uint64 commitBlock;
        uint256 testCommitId;   // the AccuracyAudit test set the bound model must use, fixed before the snapshot
        bytes32 vectorsRoot;
        uint32 vectorsCount;
        uint8 vectorsDepth;
        string vectorsURI;
        uint256 modelId;
        bool bound;
        bool invalid;
    }

    CusityRegistry public immutable registry;
    Campaign[] private _campaigns;
    mapping(address => uint256[]) private _campaignsOf;

    event Committed(uint256 indexed id, address indexed owner, bytes32 netlistHash, bytes32 extractorHash, uint64 snapshotBlock, uint256 testCommitId);
    event VectorsPublished(uint256 indexed id, bytes32 root, uint32 count, uint8 depth, string uri);
    event Bound(uint256 indexed id, uint256 indexed modelId);
    event Invalidated(uint256 indexed id, address wallet, uint32 i, uint32 j);

    error SnapshotTooSoon();
    error BindWindowClosed();
    error TestSetMismatch();
    error NotOwner();
    error BeforeSnapshot();
    error PublishWindowClosed();
    error BadTree();
    error AlreadyPublished();
    error NotPublished();
    error AlreadyBound();
    error NetlistMismatch();
    error ExtractorMismatch();
    error TestSetAfterCommit();
    error NotBound();
    error Invalid();
    error NotInSnapshot();
    error NotADuplicate();

    constructor(address registry_) { registry = CusityRegistry(registry_); }

    function commit(bytes32 netlistHash, bytes32 extractorHash, uint64 snapshotBlock, uint256 testCommitId) external returns (uint256 id) {
        if (snapshotBlock < block.number + MIN_LEAD) revert SnapshotTooSoon();
        // the test set must already exist, committed in an earlier block (review 2.6)
        (, uint64 tBlock) = IAuditCommits(address(registry.audit())).testCommitInfo(testCommitId);
        if (tBlock >= block.number) revert TestSetAfterCommit();
        id = _campaigns.length;
        Campaign storage c = _campaigns.push();
        c.owner = msg.sender; c.netlistHash = netlistHash; c.extractorHash = extractorHash;
        c.snapshotBlock = snapshotBlock; c.commitBlock = uint64(block.number); c.testCommitId = testCommitId;
        _campaignsOf[msg.sender].push(id);
        emit Committed(id, msg.sender, netlistHash, extractorHash, snapshotBlock, testCommitId);
    }

    function publishVectors(uint256 id, bytes32 root, uint32 count, uint8 depth, string calldata uri) external {
        Campaign storage c = _campaigns[id];
        if (msg.sender != c.owner) revert NotOwner();
        if (block.number <= c.snapshotBlock) revert BeforeSnapshot();
        if (block.number > uint256(c.snapshotBlock) + PUBLISH_WINDOW) revert PublishWindowClosed();
        if (c.vectorsRoot != bytes32(0)) revert AlreadyPublished();
        if (root == bytes32(0) || !PositionalMerkle.canonical(depth, count)) revert BadTree();
        c.vectorsRoot = root; c.vectorsCount = count; c.vectorsDepth = depth; c.vectorsURI = uri;
        emit VectorsPublished(id, root, count, depth, uri);
    }

    function bind(uint256 id, uint256 modelId) external {
        Campaign storage c = _campaigns[id];
        if (msg.sender != c.owner) revert NotOwner();
        if (c.bound) revert AlreadyBound();
        if (c.vectorsRoot == bytes32(0)) revert NotPublished();
        if (block.number > uint256(c.snapshotBlock) + BIND_WINDOW) revert BindWindowClosed();
        CusityRegistry.Model memory m = registry.model(modelId);
        if (m.netlistHash != c.netlistHash) revert NetlistMismatch();
        if (m.extractorHash != c.extractorHash) revert ExtractorMismatch();
        if (m.testCommitId != c.testCommitId) revert TestSetMismatch();
        c.modelId = modelId; c.bound = true;
        emit Bound(id, modelId);
    }

    function campaign(uint256 id) external view returns (Campaign memory) { return _campaigns[id]; }
    function campaignCount() external view returns (uint256) { return _campaigns.length; }
    function campaignsOf(address owner) external view returns (uint256[] memory) { return _campaignsOf[owner]; }

    function _inSnapshot(Campaign storage c, uint32 index, address wallet, bytes8 bits, bytes32[] calldata proof)
        private view returns (bool)
    {
        return index < c.vectorsCount && PositionalMerkle.verify(proof, c.vectorsRoot, c.vectorsDepth, index,
            keccak256(abi.encodePacked(index, wallet, bits)));
    }

    /// Anyone: two positions holding the same wallet void the campaign for good.
    function proveDuplicate(uint256 id, address wallet, uint32 i, bytes8 bitsI, bytes32[] calldata proofI,
                            uint32 j, bytes8 bitsJ, bytes32[] calldata proofJ) external {
        Campaign storage c = _campaigns[id];
        if (c.vectorsRoot == bytes32(0)) revert NotPublished();
        if (i == j || !_inSnapshot(c, i, wallet, bitsI, proofI) || !_inSnapshot(c, j, wallet, bitsJ, proofJ)) revert NotADuplicate();
        c.invalid = true;
        emit Invalidated(id, wallet, i, j);
    }

    function verdictOf(uint256 id, uint32 index, address wallet, bytes8 bits, bytes32[] calldata proof)
        external view returns (bool verdict, uint8 margin)
    {
        Campaign storage c = _campaigns[id];
        if (!c.bound || c.vectorsRoot == bytes32(0)) revert NotBound();
        if (c.invalid) revert Invalid();
        if (!_inSnapshot(c, index, wallet, bits, proof)) revert NotInSnapshot();
        return registry.check(c.modelId, bits);
    }
}
