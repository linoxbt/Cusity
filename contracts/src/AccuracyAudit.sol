// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITapeOutProcessor} from "./ITapeOutProcessor.sol";
import {PositionalMerkle} from "./PositionalMerkle.sol";

interface IRegistryTarget {
    function modelTarget(uint256 id) external view returns (address processor, uint256 circuitId, uint256 testCommitId);
    function audit() external view returns (address);
}

/// @title AccuracyAudit
/// @notice Scores a model on chain against its committed test set.
///  1. requestAudit fixes the next block; its hash will pick K rows.
///  2. Anyone can seal() the round while that hash is still readable (256 blocks), which stores it.
///  3. Anyone holding the public test leaves can then finalize, with no deadline once sealed.
/// The test set is a positional Merkle tree (leaf i at position i, depth committed), so each index has
/// exactly one (wallet, bits, label) and a label cannot be swapped after the fact (audit S2). Each leaf
/// names its wallet, so anyone can check the label against the public Sybil lists and recompute the bits.
/// A model has at most one open round; rounds nobody sealed in time stay on chain as Expired, with the
/// address that requested them, so the site can count them against the model (audit S5).
contract AccuracyAudit {
    enum Status { None, Pending, Ready, Done, Expired }

    struct TestCommit { address owner; bytes32 root; uint32 size; uint8 depth; uint64 blockNumber; }
    struct Round { uint256 modelId; address requester; uint64 targetBlock; bytes32 seed; bool done; uint16 correct; uint16 total; }
    /// leaf = keccak256(abi.encodePacked(index, wallet, bits, label))   (33 bytes)
    struct Row { uint32 index; address wallet; bytes8 bits; bool label; }

    uint16 public immutable K;                 // rows per round; set at deploy from measured eval gas
    address public immutable deployer;
    IRegistryTarget public registry;
    TestCommit[] public testCommits;
    Round[] public rounds;
    mapping(uint256 => uint256) public openRound;   // modelId => roundId + 1 (0 = none)

    event TestSetCommitted(uint256 indexed id, address indexed owner, bytes32 root, uint32 size, uint8 depth);
    event AuditRequested(uint256 indexed roundId, uint256 indexed modelId, address indexed requester, uint64 targetBlock);
    event AuditSealed(uint256 indexed roundId, bytes32 seed);
    event AuditFinalized(uint256 indexed roundId, uint256 indexed modelId, uint16 correct, uint16 total);

    error BadK();
    error Locked();
    error RegistryMismatch();
    error BadTree();
    error TestSetTooSmall();
    error RoundOpen(uint256 roundId);
    error NotReady(Status status);
    error HashUnavailable();
    error WrongRowCount();
    error WrongRow(uint256 j, uint32 expected);
    error BadProof(uint256 j);

    constructor(uint16 k) {
        if (k == 0) revert BadK();
        K = k; deployer = msg.sender;
    }

    /// One-time, then locked. The registry must point back at this contract, so audits and verdicts
    /// always read the same model targets.
    function setRegistry(address r) external {
        if (msg.sender != deployer || address(registry) != address(0)) revert Locked();
        if (IRegistryTarget(r).audit() != address(this)) revert RegistryMismatch();
        registry = IRegistryTarget(r);
    }

    function commitTestSet(bytes32 root, uint8 depth, uint32 size) external returns (uint256 id) {
        if (size < K) revert TestSetTooSmall();
        if (root == bytes32(0) || !PositionalMerkle.canonical(depth, size)) revert BadTree();
        id = testCommits.length;
        testCommits.push(TestCommit(msg.sender, root, size, depth, uint64(block.number)));
        emit TestSetCommitted(id, msg.sender, root, size, depth);
    }

    function testCommitInfo(uint256 id) external view returns (address owner, uint64 blockNumber) {
        TestCommit storage t = testCommits[id];
        return (t.owner, t.blockNumber);
    }

    function requestAudit(uint256 modelId) external returns (uint256 roundId) {
        registry.modelTarget(modelId);   // reverts for an unknown model
        uint256 open = openRound[modelId];
        if (open != 0) {
            Status s = status(open - 1);
            if (s == Status.Pending || s == Status.Ready) revert RoundOpen(open - 1);
        }
        roundId = rounds.length;
        uint64 target = uint64(block.number + 1);
        rounds.push(Round(modelId, msg.sender, target, bytes32(0), false, 0, 0));
        openRound[modelId] = roundId + 1;
        emit AuditRequested(roundId, modelId, msg.sender, target);
    }

    /// Store the target block's hash so the round can be finalized at any later time. Anyone can call it.
    function seal(uint256 roundId) public {
        Status s = status(roundId);
        if (s != Status.Ready) revert NotReady(s);
        Round storage r = rounds[roundId];
        if (r.seed != bytes32(0)) return;
        bytes32 h = blockhash(r.targetBlock);
        if (h == bytes32(0)) revert HashUnavailable();
        r.seed = h;
        emit AuditSealed(roundId, h);
    }

    function roundCount() external view returns (uint256) { return rounds.length; }

    function status(uint256 roundId) public view returns (Status) {
        if (roundId >= rounds.length) return Status.None;
        Round storage r = rounds[roundId];
        if (r.done) return Status.Done;
        if (block.number <= r.targetBlock) return Status.Pending;
        if (r.seed != bytes32(0)) return Status.Ready;
        if (block.number > uint256(r.targetBlock) + 256) return Status.Expired;
        return Status.Ready;
    }

    function _seed(Round storage r) private view returns (bytes32 h) {
        h = r.seed != bytes32(0) ? r.seed : blockhash(r.targetBlock);
        if (h == bytes32(0)) revert HashUnavailable();
    }

    /// Index of sample j in a round. Valid only while the round is Ready.
    function sampleIndex(uint256 roundId, uint256 j) public view returns (uint32) {
        Status s = status(roundId);
        if (s != Status.Ready) revert NotReady(s);
        Round storage r = rounds[roundId];
        (, , uint256 tc) = registry.modelTarget(r.modelId);
        return uint32(uint256(keccak256(abi.encode(_seed(r), roundId, j))) % testCommits[tc].size);
    }

    function sampleIndices(uint256 roundId) external view returns (uint32[] memory idx) {
        idx = new uint32[](K);
        for (uint256 j; j < K; ++j) idx[j] = sampleIndex(roundId, j);
    }

    function finalizeAudit(uint256 roundId, Row[] calldata rows, bytes32[][] calldata proofs)
        external returns (uint16 correct, uint16 total)
    {
        seal(roundId);   // reverts unless Ready; stores the hash if still unsealed
        if (rows.length != K || proofs.length != K) revert WrongRowCount();
        Round storage r = rounds[roundId];
        (address processor, uint256 circuitId, uint256 tc) = registry.modelTarget(r.modelId);
        TestCommit storage t = testCommits[tc];
        for (uint256 j; j < K; ++j) {
            Row calldata row = rows[j];
            uint32 want = sampleIndex(roundId, j);
            if (row.index != want) revert WrongRow(j, want);
            bytes32 leaf = keccak256(abi.encodePacked(row.index, row.wallet, row.bits, row.label));
            if (!PositionalMerkle.verify(proofs[j], t.root, t.depth, row.index, leaf)) revert BadProof(j);
            bytes memory out = ITapeOutProcessor(processor).eval(circuitId, abi.encodePacked(row.bits));
            if (((uint8(out[0]) & 1) == 1) == row.label) ++correct;
        }
        total = K;
        r.done = true; r.correct = correct; r.total = total;
        emit AuditFinalized(roundId, r.modelId, correct, total);
    }
}
