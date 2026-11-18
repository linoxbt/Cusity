// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITapeOutProcessor} from "./ITapeOutProcessor.sol";

interface IAuditCommits {
    function testCommitInfo(uint256 id) external view returns (address owner, uint64 blockNumber);
}

/// @title CusityRegistry
/// @notice A list of model cards. Each model points at one taped-out TapeOut circuit. The netlist
/// hash is computed here from the processor's own bytes, so nobody has to trust a typed-in hash.
/// No admin, no upgrades: a registered model can't be changed.
contract CusityRegistry {
    struct Model {
        address owner;
        address processor;
        uint256 circuitId;
        bytes32 netlistHash;     // sha256(processor.netlist(circuitId)), computed here
        bytes32 extractorHash;   // sha256 of the extractor bundle (sources + config), see data/extractor_hash.ts
        uint256 testCommitId;    // AccuracyAudit test-set commit made before registration
        uint32 gateCount;
        uint64 registeredBlock;
        string cardURI;
    }

    uint32 public constant N_IN = 64;
    uint32 public constant N_OUT = 7;   // output bit 0 = verdict, bits 1..6 = margin (LSB first, offset 32)

    IAuditCommits public immutable audit;
    Model[] private _models;

    event ModelRegistered(uint256 indexed modelId, address indexed owner, address processor,
                          uint256 circuitId, bytes32 netlistHash, uint32 gateCount);

    error Shape(uint32 nIn, uint32 nOut, uint32 nState);
    error NotYourTestCommit();
    error TestCommitTooRecent();

    constructor(address audit_) { audit = IAuditCommits(audit_); }

    function register(address processor, uint256 circuitId, bytes32 extractorHash,
                      uint256 testCommitId, string calldata cardURI) external returns (uint256 modelId) {
        ITapeOutProcessor p = ITapeOutProcessor(processor);
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = p.circuitInfo(circuitId);
        if (nIn != N_IN || nOut != N_OUT || nState != 0) revert Shape(nIn, nOut, nState);
        (address tOwner, uint64 tBlock) = audit.testCommitInfo(testCommitId);
        if (tOwner != msg.sender) revert NotYourTestCommit();
        if (tBlock >= block.number) revert TestCommitTooRecent();
        bytes32 h = sha256(p.netlist(circuitId));
        modelId = _models.length;
        _models.push(Model(msg.sender, processor, circuitId, h, extractorHash, testCommitId, gates,
                           uint64(block.number), cardURI));
        emit ModelRegistered(modelId, msg.sender, processor, circuitId, h, gates);
    }

    function model(uint256 id) external view returns (Model memory) { return _models[id]; }
    function modelCount() external view returns (uint256) { return _models.length; }

    function modelTarget(uint256 id) external view returns (address processor, uint256 circuitId, uint256 testCommitId) {
        Model storage m = _models[id];
        return (m.processor, m.circuitId, m.testCommitId);
    }

    /// @notice Free to call with eth_call. verdict = true means "flagged by the filter".
    function check(uint256 id, bytes8 bits) public view returns (bool verdict, uint8 margin) {
        Model storage m = _models[id];
        return decode(ITapeOutProcessor(m.processor).eval(m.circuitId, abi.encodePacked(bits)));
    }

    function decode(bytes memory out) public pure returns (bool verdict, uint8 margin) {
        uint8 b = uint8(out[0]);
        verdict = (b & 1) == 1;
        margin = (b >> 1) & 0x3f;
    }
}
