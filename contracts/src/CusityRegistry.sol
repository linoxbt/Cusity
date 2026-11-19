// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITapeOutProcessor, ITapeOutFactory} from "./ITapeOutProcessor.sol";

interface IAuditCommits {
    function testCommitInfo(uint256 id) external view returns (address owner, uint64 blockNumber);
}

/// @title CusityRegistry
/// @notice A list of model cards. Each model points at one taped-out TapeOut circuit. The netlist
/// hash is computed here from the processor's own bytes, so nobody has to trust a typed-in hash.
/// No admin, no upgrades: a registered model can't be changed.
/// Only genuine TapeOut processors are accepted (audit S1): the factory must list the processor AND its
/// runtime code must be one of the processor-proxy builds fixed at deploy. Those proxies embed their beacon
/// address in code, and that beacon's owner is renounced, so the evaluator behind an accepted processor can
/// never change and cannot answer different callers differently.
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
    ITapeOutFactory public immutable factory;
    mapping(bytes32 => bool) public allowedProcessorCode;
    mapping(bytes32 => uint256) public modelOfNetlist;   // netlist hash => modelId + 1: one model per circuit
    Model[] private _models;

    event ModelRegistered(uint256 indexed modelId, address indexed owner, address processor,
                          uint256 circuitId, bytes32 netlistHash, uint32 gateCount);

    error Shape(uint32 nIn, uint32 nOut, uint32 nState);
    error NotATapeOutProcessor();
    error AlreadyRegistered(uint256 modelId);
    error TestCommitTooRecent();

    constructor(address audit_, address factory_, bytes32[] memory processorCodehashes) {
        audit = IAuditCommits(audit_); factory = ITapeOutFactory(factory_);
        for (uint256 i; i < processorCodehashes.length; ++i) allowedProcessorCode[processorCodehashes[i]] = true;
    }

    function register(address processor, uint256 circuitId, bytes32 extractorHash,
                      uint256 testCommitId, string calldata cardURI) external returns (uint256 modelId) {
        if (!allowedProcessorCode[processor.codehash] || !factory.isCPU(processor)) revert NotATapeOutProcessor();
        ITapeOutProcessor p = ITapeOutProcessor(processor);
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = p.circuitInfo(circuitId);
        if (nIn != N_IN || nOut != N_OUT || nState != 0) revert Shape(nIn, nOut, nState);
        // Any test commit made before this block may be used: a campaign can pin one committed by someone
        // independent of the model's author (CampaignCommit.bind enforces the pin).
        (, uint64 tBlock) = audit.testCommitInfo(testCommitId);
        if (tBlock >= block.number) revert TestCommitTooRecent();
        bytes32 h = sha256(p.netlist(circuitId));
        // One registration per circuit: the same netlist can't be registered again with a friendlier test set.
        if (modelOfNetlist[h] != 0) revert AlreadyRegistered(modelOfNetlist[h] - 1);
        modelId = _models.length;
        modelOfNetlist[h] = modelId + 1;
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
