// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {RefProcessor} from "./RefProcessor.sol";
import {MerkleHelper} from "./MerkleHelper.sol";
import {CusityRegistry} from "../src/CusityRegistry.sol";
import {CampaignCommit} from "../src/CampaignCommit.sol";
import {AccuracyAudit} from "../src/AccuracyAudit.sol";

contract CusityTest is Test {
    RefProcessor proc;
    AccuracyAudit audit;
    CusityRegistry registry;
    CampaignCommit campaigns;
    uint256 circuitId;           // the real toy model netlist from build/
    bytes netlistBytes;
    uint16 constant K = 4;

    // test set: 8 rows built from the fixture vectors
    bytes8[8] tBits;
    bool[8] tLabel;
    bytes32[] tLeaves;

    function setUp() public {
        vm.roll(1000);
        proc = new RefProcessor();
        audit = new AccuracyAudit(K);
        registry = new CusityRegistry(address(audit));
        audit.setRegistry(address(registry));
        campaigns = new CampaignCommit(address(registry));

        string memory nl = vm.readFile("../build/toy.netlist.json");
        netlistBytes = vm.parseJsonBytes(nl, ".netlist");
        circuitId = proc.tapeout(netlistBytes, 64, 7);

        for (uint256 i; i < 8; ++i) {
            tBits[i] = bytes8(keccak256(abi.encode("row", i)));
            (bool v,) = registry.decode(proc.eval(circuitId, abi.encodePacked(tBits[i])));
            tLabel[i] = i == 5 ? !v : v;   // the model gets exactly row 5 wrong
            tLeaves.push(keccak256(abi.encodePacked(uint32(i), tBits[i], tLabel[i])));
        }
    }

    function _register() internal returns (uint256 testCommitId, uint256 modelId) {
        testCommitId = audit.commitTestSet(MerkleHelper.root(tLeaves), 8);
        vm.roll(block.number + 1);
        modelId = registry.register(address(proc), circuitId, keccak256("extractor"), testCommitId, "ipfs://card");
    }

    // ---------------------------------------------------------------- processor + fixture

    function test_fixtureMatchesPython() public view {
        string memory fx = vm.readFile("../build/fixture.json");
        for (uint256 i; i < 3; ++i) {
            string memory p = string.concat(".vectors[", vm.toString(i), "]");
            bytes memory bits = vm.parseJsonBytes(fx, string.concat(p, ".bits"));
            uint256 v = vm.parseJsonUint(fx, string.concat(p, ".verdict"));
            uint256 m = vm.parseJsonUint(fx, string.concat(p, ".margin"));
            (bool verdict, uint8 margin) = registry.decode(proc.eval(circuitId, bits));
            assertEq(verdict ? 1 : 0, v, "verdict differs from Python tap02");
            assertEq(margin, m, "margin differs from Python tap02");
        }
    }

    function test_evalGas() public view {
        uint256 g = gasleft();
        proc.eval(circuitId, abi.encodePacked(tBits[0]));
        uint256 used = g - gasleft();
        (,,, uint32 gates) = proc.circuitInfo(circuitId);
        console.log("RefProcessor eval gas:", used, "gates:", gates);
        console.log("approx gas per gate:", used / gates);
    }

    function test_xorLikeLiveChain() public {
        // the 3-gate circuit read from a live X Layer processor: NAND(a,b), then NOT, NOT
        uint256 id = proc.tapeout(hex"000000020000030000000400000400000005000005", 2, 1);
        assertEq(proc.eval(id, hex"00"), hex"01");
        assertEq(proc.eval(id, hex"03"), hex"00");
    }

    function test_tapeoutRejectsForwardRef() public {
        vm.expectRevert("NAND: future signal");
        proc.tapeout(hex"00000002000003", 0, 1);   // nIn=0: signals 2,3 don't exist yet
    }

    // ---------------------------------------------------------------- registry

    function test_registerComputesHash() public {
        (, uint256 modelId) = _register();
        CusityRegistry.Model memory m = registry.model(modelId);
        assertEq(m.netlistHash, sha256(netlistBytes));
        assertEq(m.gateCount, netlistBytes.length / 7);
    }

    function test_registerShape() public {
        uint256 bad = proc.tapeout(hex"000000020000030000000400000400000005000005", 2, 1);
        uint256 tc = audit.commitTestSet(MerkleHelper.root(tLeaves), 8);
        vm.roll(block.number + 1);
        vm.expectRevert(abi.encodeWithSelector(CusityRegistry.Shape.selector, 2, 1, 0));
        registry.register(address(proc), bad, 0, tc, "");
    }

    function test_registerNeedsOwnEarlierTestCommit() public {
        uint256 tc = audit.commitTestSet(MerkleHelper.root(tLeaves), 8);
        vm.expectRevert(CusityRegistry.TestCommitTooRecent.selector);
        registry.register(address(proc), circuitId, 0, tc, "");
        vm.roll(block.number + 1);
        vm.prank(address(0xBEEF));
        vm.expectRevert(CusityRegistry.NotYourTestCommit.selector);
        registry.register(address(proc), circuitId, 0, tc, "");
    }

    function test_checkMatchesProcessor() public {
        (, uint256 modelId) = _register();
        for (uint256 i; i < 8; ++i) {
            (bool v, uint8 m) = registry.check(modelId, tBits[i]);
            (bool v2, uint8 m2) = registry.decode(proc.eval(circuitId, abi.encodePacked(tBits[i])));
            assertEq(v, v2); assertEq(m, m2);
        }
    }

    // ---------------------------------------------------------------- campaign

    function _campaignReady() internal returns (uint256 cid, bytes32[] memory leaves, address[] memory wallets) {
        (, uint256 modelId) = _register();
        vm.roll(block.number + 1);
        cid = campaigns.commit(sha256(netlistBytes), keccak256("extractor"), uint64(block.number + 10));
        wallets = new address[](4); leaves = new bytes32[](4);
        for (uint256 i; i < 4; ++i) {
            wallets[i] = address(uint160(0x1000 + i));
            leaves[i] = keccak256(abi.encodePacked(wallets[i], tBits[i]));
        }
        vm.roll(block.number + 11);
        campaigns.publishVectors(cid, MerkleHelper.root(leaves), "ipfs://vectors");
        campaigns.bind(cid, modelId);
    }

    function test_campaignFlow() public {
        (uint256 cid, bytes32[] memory leaves, address[] memory wallets) = _campaignReady();
        for (uint256 i; i < 4; ++i) {
            (bool v, uint8 m) = campaigns.verdictOf(cid, wallets[i], tBits[i], MerkleHelper.proof(leaves, i));
            (bool v2, uint8 m2) = registry.decode(proc.eval(circuitId, abi.encodePacked(tBits[i])));
            assertEq(v, v2); assertEq(m, m2);
        }
    }

    function testFuzz_verdictOfRejectsAlteredBits(bytes8 other) public {
        (uint256 cid, bytes32[] memory leaves, address[] memory wallets) = _campaignReady();
        vm.assume(other != tBits[2]);
        bytes32[] memory p = MerkleHelper.proof(leaves, 2);
        vm.expectRevert(CampaignCommit.NotInSnapshot.selector);
        campaigns.verdictOf(cid, wallets[2], other, p);
    }

    function test_commitAfterSnapshotReverts() public {
        vm.expectRevert(CampaignCommit.SnapshotPassed.selector);
        campaigns.commit(0, 0, uint64(block.number));
    }

    function test_publishBeforeSnapshotReverts() public {
        uint256 cid = campaigns.commit(0, 0, uint64(block.number + 5));
        vm.expectRevert(CampaignCommit.BeforeSnapshot.selector);
        campaigns.publishVectors(cid, bytes32(uint256(1)), "");
    }

    function test_bindRejectsDifferentNetlist() public {
        (, uint256 modelId) = _register();
        vm.roll(block.number + 1);
        uint256 cid = campaigns.commit(sha256("another netlist"), keccak256("extractor"), uint64(block.number + 2));
        vm.expectRevert(CampaignCommit.NetlistMismatch.selector);
        campaigns.bind(cid, modelId);
    }

    function test_bindRejectsTestSetCommittedAfterCampaign() public {
        uint256 cid = campaigns.commit(sha256(netlistBytes), keccak256("extractor"), uint64(block.number + 50));
        (, uint256 modelId) = _register();   // test set committed after the campaign commit
        vm.expectRevert(CampaignCommit.TestSetAfterCommit.selector);
        campaigns.bind(cid, modelId);
    }

    // ---------------------------------------------------------------- audit

    function _rows(uint256 roundId) internal view returns (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) {
        uint32[] memory idx = audit.sampleIndices(roundId);
        rows = new AccuracyAudit.Row[](K); proofs = new bytes32[][](K);
        for (uint256 j; j < K; ++j) {
            rows[j] = AccuracyAudit.Row(idx[j], tBits[idx[j]], tLabel[idx[j]]);
            proofs[j] = MerkleHelper.proof(tLeaves, idx[j]);
        }
    }

    function test_auditScoresOnChain() public {
        (, uint256 modelId) = _register();
        uint256 r = audit.requestAudit(modelId);
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.NotReady.selector, AccuracyAudit.Status.Pending));
        audit.sampleIndex(r, 0);
        vm.roll(block.number + 2);
        (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) = _rows(r);
        uint16 expect;
        for (uint256 j; j < K; ++j) if (rows[j].index != 5) ++expect;
        vm.prank(address(0xA11CE));   // anyone can finalize
        uint256 g = gasleft();
        (uint16 correct, uint16 total) = audit.finalizeAudit(r, rows, proofs);
        console.log("finalizeAudit gas (K=4):", g - gasleft());
        assertEq(correct, expect); assertEq(total, K);
        assertEq(uint8(audit.status(r)), uint8(AccuracyAudit.Status.Done));
    }

    function test_auditWrongRowReverts() public {
        (, uint256 modelId) = _register();
        uint256 r = audit.requestAudit(modelId);
        vm.roll(block.number + 2);
        (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) = _rows(r);
        uint32 want = rows[0].index;
        rows[0].index = (want + 1) % 8;
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.WrongRow.selector, 0, want));
        audit.finalizeAudit(r, rows, proofs);
    }

    function testFuzz_auditRejectsAlteredRow(bytes8 other) public {
        (, uint256 modelId) = _register();
        uint256 r = audit.requestAudit(modelId);
        vm.roll(block.number + 2);
        (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) = _rows(r);
        vm.assume(other != rows[1].bits);
        rows[1].bits = other;
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.BadProof.selector, 1));
        audit.finalizeAudit(r, rows, proofs);
    }

    function test_oneOpenRoundAndExpiredStaysVisible() public {
        (, uint256 modelId) = _register();
        uint256 r0 = audit.requestAudit(modelId);
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.RoundOpen.selector, r0));
        audit.requestAudit(modelId);
        vm.roll(block.number + 258);   // owner walks away from round 0
        assertEq(uint8(audit.status(r0)), uint8(AccuracyAudit.Status.Expired));
        uint256 r1 = audit.requestAudit(modelId);
        assertEq(r1, r0 + 1);
        assertEq(uint8(audit.status(r0)), uint8(AccuracyAudit.Status.Expired));   // stays on record
    }

    function test_setRegistryLocks() public {
        vm.expectRevert(AccuracyAudit.Locked.selector);
        audit.setRegistry(address(1));
    }
}

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// Leaves and proofs built by data/merkle.ts (TypeScript, OpenZeppelin JS merkle-tree) must verify here.
contract MerkleCompatTest is Test {
    function test_tsTestLeavesVerifyInSolidity() public view {
        string memory j = vm.readFile("../build/toy_test_leaves.json");
        bytes32 root = vm.parseJsonBytes32(j, ".root");
        uint256 size = vm.parseJsonUint(j, ".size");
        for (uint256 i; i < size; i += 7) {
            string memory p = string.concat(".leaves[", vm.toString(i), "]");
            bytes8 bits = bytes8(vm.parseJsonBytes(j, string.concat(p, ".bits")));
            bool label = vm.parseJsonUint(j, string.concat(p, ".label")) == 1;
            bytes32 leaf = keccak256(abi.encodePacked(uint32(i), bits, label));
            assertEq(leaf, vm.parseJsonBytes32(j, string.concat(p, ".leaf")), "leaf encoding differs");
            assertTrue(MerkleProof.verify(vm.parseJsonBytes32Array(j, string.concat(p, ".proof")), root, leaf), "proof rejected");
        }
    }
}
