// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ITapeOutProcessor} from "./ITapeOutProcessor.sol";

interface IRegistryTarget {
    function modelTarget(uint256 id) external view returns (address processor, uint256 circuitId, uint256 testCommitId);
}

/// @title AccuracyAudit
/// @notice Scores a model on chain against its committed test set. requestAudit fixes the next block;
/// its hash picks K rows; anyone holding the public test leaves can finalize within 256 blocks.
/// Against cherry-picking (review 2.1): a model has at most one open round at a time, and rounds that
/// are never finalized stay on chain as Expired, so the site can show them next to the scores.
contract AccuracyAudit {
    enum Status { None, Pending, Ready, Done, Expired }

    struct TestCommit { address owner; bytes32 root; uint32 size; uint64 blockNumber; }
    struct Round { uint256 modelId; uint64 targetBlock; bool done; uint16 correct; uint16 total; }
    struct Row { uint32 index; bytes8 bits; bool label; }   // leaf = keccak256(abi.encodePacked(index, bits, label))

    uint16 public immutable K;                 // rows per round; set at deploy from measured eval gas
    address public immutable deployer;
    IRegistryTarget public registry;
    TestCommit[] public testCommits;
    Round[] public rounds;
    mapping(uint256 => uint256) public openRound;   // modelId => roundId + 1 (0 = none)

    event TestSetCommitted(uint256 indexed id, address indexed owner, bytes32 root, uint32 size);
    event AuditRequested(uint256 indexed roundId, uint256 indexed modelId, uint64 targetBlock);
    event AuditFinalized(uint256 indexed roundId, uint256 indexed modelId, uint16 correct, uint16 total);

    error Locked();
    error TestSetTooSmall();
    error RoundOpen(uint256 roundId);
    error NotReady(Status status);
    error WrongRowCount();
    error WrongRow(uint256 j, uint32 expected);
    error BadProof(uint256 j);

    constructor(uint16 k) { K = k; deployer = msg.sender; }

    function setRegistry(address r) external {   // one-time, then locked
        if (msg.sender != deployer || address(registry) != address(0)) revert Locked();
        registry = IRegistryTarget(r);
    }

    function commitTestSet(bytes32 root, uint32 size) external returns (uint256 id) {
        if (size < K) revert TestSetTooSmall();
        id = testCommits.length;
        testCommits.push(TestCommit(msg.sender, root, size, uint64(block.number)));
        emit TestSetCommitted(id, msg.sender, root, size);
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
        rounds.push(Round(modelId, target, false, 0, 0));
        openRound[modelId] = roundId + 1;
        emit AuditRequested(roundId, modelId, target);
    }

    function roundCount() external view returns (uint256) { return rounds.length; }

    function status(uint256 roundId) public view returns (Status) {
        if (roundId >= rounds.length) return Status.None;
        Round storage r = rounds[roundId];
        if (r.done) return Status.Done;
        if (block.number <= r.targetBlock) return Status.Pending;
        if (block.number > uint256(r.targetBlock) + 256) return Status.Expired;
        return Status.Ready;
    }

    /// Index of sample j in a round. Valid only while the round is Ready.
    function sampleIndex(uint256 roundId, uint256 j) public view returns (uint32) {
        Status s = status(roundId);
        if (s != Status.Ready) revert NotReady(s);
        Round storage r = rounds[roundId];
        (, , uint256 tc) = registry.modelTarget(r.modelId);
        return uint32(uint256(keccak256(abi.encode(blockhash(r.targetBlock), roundId, j))) % testCommits[tc].size);
    }

    function sampleIndices(uint256 roundId) external view returns (uint32[] memory idx) {
        idx = new uint32[](K);
        for (uint256 j; j < K; ++j) idx[j] = sampleIndex(roundId, j);
    }

    function finalizeAudit(uint256 roundId, Row[] calldata rows, bytes32[][] calldata proofs)
        external returns (uint16 correct, uint16 total)
    {
        Status s = status(roundId);
        if (s != Status.Ready) revert NotReady(s);
        if (rows.length != K || proofs.length != K) revert WrongRowCount();
        Round storage r = rounds[roundId];
        (address processor, uint256 circuitId, uint256 tc) = registry.modelTarget(r.modelId);
        bytes32 root = testCommits[tc].root;
        for (uint256 j; j < K; ++j) {
            Row calldata row = rows[j];
            uint32 want = sampleIndex(roundId, j);
            if (row.index != want) revert WrongRow(j, want);
            bytes32 leaf = keccak256(abi.encodePacked(row.index, row.bits, row.label));
            if (!MerkleProof.verifyCalldata(proofs[j], root, leaf)) revert BadProof(j);
            bytes memory out = ITapeOutProcessor(processor).eval(circuitId, abi.encodePacked(row.bits));
            if (((uint8(out[0]) & 1) == 1) == row.label) ++correct;
        }
        total = K;
        r.done = true; r.correct = correct; r.total = total;
        emit AuditFinalized(roundId, r.modelId, correct, total);
    }
}
