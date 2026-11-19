// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {RefProcessor} from "./RefProcessor.sol";
import {PositionalHelper as PH} from "./PositionalHelper.sol";
import {CusityRegistry} from "../src/CusityRegistry.sol";
import {CampaignCommit} from "../src/CampaignCommit.sol";
import {AccuracyAudit} from "../src/AccuracyAudit.sol";
import {ITapeOutProcessor, ITapeOutFactory} from "../src/ITapeOutProcessor.sol";

contract MockFactory is ITapeOutFactory {
    mapping(address => bool) public isCPU;
    function add(address p) external { isCPU[p] = true; }
}

/// The audit's attack (S1): returns the honest netlist so the hash matches, but lies to everyone but the audit.
contract EvilProcessor is ITapeOutProcessor {
    RefProcessor immutable honest; address public auditor;
    constructor(RefProcessor h) { honest = h; }
    function setAuditor(address a) external { auditor = a; }
    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) { return honest.circuitInfo(id); }
    function netlist(uint256 id) external view returns (bytes memory) { return honest.netlist(id); }
    function eval(uint256 id, bytes calldata i) external view returns (bytes memory) {
        return msg.sender == auditor ? honest.eval(id, i) : bytes(hex"00");
    }
}

/// circuitInfo reports one latch (nState = 1): such circuits can't be evaluated statelessly and are refused.
contract StatefulProc is ITapeOutProcessor {
    RefProcessor immutable inner;
    constructor(RefProcessor i) { inner = i; }
    function circuitInfo(uint256 id) external view returns (uint32 a, uint32 b, uint32, uint32 g) { (a, b,, g) = inner.circuitInfo(id); return (a, b, 1, g); }
    function netlist(uint256 id) external view returns (bytes memory) { return inner.netlist(id); }
    function eval(uint256 id, bytes calldata i) external view returns (bytes memory) { return inner.eval(id, i); }
}

contract CusityTest is Test {
    RefProcessor proc;
    MockFactory factory;
    AccuracyAudit audit;
    CusityRegistry registry;
    CampaignCommit campaigns;
    uint256 circuitId;           // the real toy model netlist from build/
    bytes netlistBytes;
    bytes32 constant EXT = keccak256("extractor");
    uint16 constant K = 4;
    uint256 constant N = 11;     // test rows: not a power of two, so padding is exercised

    bytes8[N] tBits;
    bool[N] tLabel;
    bool[N] tModel;              // the circuit's verdict on each row, read once in setUp
    address[N] tWallet;

    function setUp() public {
        vm.roll(1000);
        proc = new RefProcessor();
        factory = new MockFactory(); factory.add(address(proc));
        audit = new AccuracyAudit(K);
        bytes32[] memory code = new bytes32[](1); code[0] = address(proc).codehash;
        registry = new CusityRegistry(address(audit), address(factory), code);
        audit.setRegistry(address(registry));
        campaigns = new CampaignCommit(address(registry));

        netlistBytes = vm.parseJsonBytes(vm.readFile("../build/toy.netlist.json"), ".netlist");
        circuitId = proc.tapeout(netlistBytes, 64, 7);
        for (uint256 i; i < N; ++i) {
            tBits[i] = bytes8(keccak256(abi.encode("row", i)));
            tWallet[i] = address(uint160(0xA000 + i));
            (tModel[i],) = registry.decode(proc.eval(circuitId, abi.encodePacked(tBits[i])));
            tLabel[i] = tModel[i];
        }
    }

    // ---------------------------------------------------------------- helpers

    function _testLeaves(bool[N] memory labels) internal view returns (bytes32[] memory l) {
        l = new bytes32[](N);
        for (uint256 i; i < N; ++i) l[i] = keccak256(abi.encodePacked(uint32(i), tWallet[i], tBits[i], labels[i]));
    }

    function _commitTests(bool[N] memory labels) internal returns (uint256) {
        return audit.commitTestSet(PH.root(_testLeaves(labels)), PH.depthFor(N), uint32(N));
    }

    function _register(bool[N] memory labels) internal returns (uint256 tc, uint256 modelId) {
        tc = _commitTests(labels);
        vm.roll(block.number + 1);
        modelId = registry.register(address(proc), circuitId, EXT, tc, "ipfs://card");
    }
    function _register() internal returns (uint256, uint256) { return _register(tLabel); }

    function _ready(uint256 roundId) internal {
        (, , uint64 target,,,,,) = audit.rounds(roundId);
        vm.roll(uint256(target) + 1);
        vm.setBlockhash(target, keccak256(abi.encode("hash", roundId)));
    }

    function _rows(uint256 roundId, bool[N] memory labels)
        internal view returns (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs)
    {
        uint32[] memory idx = audit.sampleIndices(roundId);
        bytes32[] memory leaves = _testLeaves(labels);
        rows = new AccuracyAudit.Row[](K); proofs = new bytes32[][](K);
        for (uint256 j; j < K; ++j) {
            rows[j] = AccuracyAudit.Row(idx[j], tWallet[idx[j]], tBits[idx[j]], labels[idx[j]]);
            proofs[j] = PH.proof(leaves, idx[j]);
        }
    }

    function _flipped() internal view returns (bool[N] memory f) { for (uint256 i; i < N; ++i) f[i] = !tLabel[i]; }
    function _mixed() internal view returns (bool[N] memory f) { for (uint256 i; i < N; ++i) f[i] = i % 3 == 0 ? !tLabel[i] : tLabel[i]; }

    // ---------------------------------------------------------------- processor + fixture

    function test_fixtureMatchesPython() public view {
        string memory fx = vm.readFile("../build/fixture.json");
        for (uint256 i; i < 3; ++i) {
            string memory p = string.concat(".vectors[", vm.toString(i), "]");
            bytes memory bits = vm.parseJsonBytes(fx, string.concat(p, ".bits"));
            (bool verdict, uint8 margin) = registry.decode(proc.eval(circuitId, bits));
            assertEq(verdict ? 1 : 0, vm.parseJsonUint(fx, string.concat(p, ".verdict")), "verdict differs from Python tap02");
            assertEq(margin, vm.parseJsonUint(fx, string.concat(p, ".margin")), "margin differs from Python tap02");
        }
    }

    function test_xorLikeLiveChain() public {
        uint256 id = proc.tapeout(hex"000000020000030000000400000400000005000005", 2, 1);
        assertEq(proc.eval(id, hex"00"), hex"01");
        assertEq(proc.eval(id, hex"03"), hex"00");
    }

    function test_tapeoutRejectsForwardRef() public {
        vm.expectRevert("NAND: future signal");
        proc.tapeout(hex"00000002000003", 0, 1);
    }

    // ---------------------------------------------------------------- registry

    function test_registerComputesHash() public {
        (, uint256 modelId) = _register();
        CusityRegistry.Model memory m = registry.model(modelId);
        assertEq(m.netlistHash, sha256(netlistBytes));
        assertEq(m.gateCount, netlistBytes.length / 7);
        assertEq(m.owner, address(this)); assertEq(m.extractorHash, EXT);
    }

    function test_checkMatchesPythonFixture() public {
        (, uint256 modelId) = _register();
        string memory fx = vm.readFile("../build/fixture.json");
        for (uint256 i; i < 3; ++i) {
            string memory p = string.concat(".vectors[", vm.toString(i), "]");
            (bool v, uint8 m) = registry.check(modelId, bytes8(vm.parseJsonBytes(fx, string.concat(p, ".bits"))));
            assertEq(v ? 1 : 0, vm.parseJsonUint(fx, string.concat(p, ".verdict")));
            assertEq(m, vm.parseJsonUint(fx, string.concat(p, ".margin")));
        }
    }

    function test_registerShape() public {
        uint256 bad = proc.tapeout(hex"000000020000030000000400000400000005000005", 2, 1);
        uint256 tc = _commitTests(tLabel);
        vm.roll(block.number + 1);
        vm.expectRevert(abi.encodeWithSelector(CusityRegistry.Shape.selector, 2, 1, 0));
        registry.register(address(proc), bad, 0, tc, "");
    }

    function test_registerNeedsAnEarlierTestCommitAndOnlyOncePerNetlist() public {
        vm.prank(address(0x9A0));
        uint256 tc = _commitTests(tLabel);
        vm.expectRevert(CusityRegistry.TestCommitTooRecent.selector);
        registry.register(address(proc), circuitId, 0, tc, "");
        vm.roll(block.number + 1);
        uint256 m = registry.register(address(proc), circuitId, EXT, tc, "");   // someone else's commit is fine
        uint256 tc2 = _commitTests(_flipped());
        vm.roll(vm.getBlockNumber() + 1);   // via_ir can reuse a stale block.number after an earlier roll
        vm.expectRevert(abi.encodeWithSelector(CusityRegistry.AlreadyRegistered.selector, m));
        registry.register(address(proc), circuitId, EXT, tc2, "");             // no test-set shopping
        assertEq(registry.modelOfNetlist(sha256(netlistBytes)), m + 1);
    }

    function test_registerRejectsStatefulCircuits() public {
        StatefulProc sp = new StatefulProc(proc);
        bytes32[] memory code = new bytes32[](1); code[0] = address(sp).codehash;
        MockFactory f2 = new MockFactory(); f2.add(address(sp));
        AccuracyAudit a2 = new AccuracyAudit(K);
        CusityRegistry r2 = new CusityRegistry(address(a2), address(f2), code);
        a2.setRegistry(address(r2));
        uint256 tc = a2.commitTestSet(PH.root(_testLeaves(tLabel)), PH.depthFor(N), uint32(N));
        vm.roll(block.number + 1);
        vm.expectRevert(abi.encodeWithSelector(CusityRegistry.Shape.selector, 64, 7, 1));
        r2.register(address(sp), circuitId, EXT, tc, "");
    }

    function test_decodeMasksTheMargin() public view {
        (bool v, uint8 m) = registry.decode(hex"ff");
        assertTrue(v); assertEq(m, 63);
        (v, m) = registry.decode(hex"80");
        assertFalse(v); assertEq(m, 0);                   // bit 7 is not part of the margin
    }

    /// Audit S1: a fake processor serving the honest netlist can no longer be registered.
    function test_rejectsFakeProcessor() public {
        EvilProcessor evil = new EvilProcessor(proc);
        factory.add(address(evil));                      // even if the factory were fooled, its code is not allowed
        uint256 tc = _commitTests(tLabel);
        vm.roll(block.number + 1);
        vm.expectRevert(CusityRegistry.NotATapeOutProcessor.selector);
        registry.register(address(evil), circuitId, EXT, tc, "");
    }

    function test_rejectsProcessorTheFactoryDidNotCreate() public {
        RefProcessor clone = new RefProcessor();         // same code hash, but not listed by the factory
        uint256 id = clone.tapeout(netlistBytes, 64, 7);
        uint256 tc = _commitTests(tLabel);
        vm.roll(block.number + 1);
        vm.expectRevert(CusityRegistry.NotATapeOutProcessor.selector);
        registry.register(address(clone), id, EXT, tc, "");
    }

    // ---------------------------------------------------------------- campaign

    function _snap(uint256 n) internal view returns (bytes32[] memory leaves, address[] memory wallets) {
        leaves = new bytes32[](n); wallets = new address[](n);
        for (uint256 i; i < n; ++i) {
            wallets[i] = tWallet[i];   // ascending
            leaves[i] = keccak256(abi.encodePacked(uint32(i), wallets[i], tBits[i]));
        }
    }

    uint64 constant LEAD = 86_400;   // CampaignCommit.MIN_LEAD
    uint256 tcMain;                  // the test commit _register() made

    function _committed() internal returns (uint256 cid, uint256 modelId) {
        (tcMain, modelId) = _register();
        vm.roll(block.number + 1);
        cid = campaigns.commit(sha256(netlistBytes), EXT, uint64(block.number + LEAD), tcMain);
    }

    function _toPublish(uint256 cid) internal { vm.roll(uint256(campaigns.campaign(cid).snapshotBlock) + 1); }

    function _campaignReady() internal returns (uint256 cid, bytes32[] memory leaves, address[] memory wallets) {
        uint256 modelId;
        (cid, modelId) = _committed();
        (leaves, wallets) = _snap(5);
        _toPublish(cid);
        campaigns.publishVectors(cid, PH.root(leaves), 5, PH.depthFor(5), "https://x/snapshot/list.json");
        campaigns.bind(cid, modelId);
    }

    function test_campaignFlowMatchesFixture() public {
        (uint256 cid, bytes32[] memory leaves, address[] memory wallets) = _campaignReady();
        for (uint256 i; i < 5; ++i) {
            (bool v,) = campaigns.verdictOf(cid, uint32(i), wallets[i], tBits[i], PH.proof(leaves, i));
            assertEq(v, tModel[i]);
        }
        CampaignCommit.Campaign memory c = campaigns.campaign(cid);
        assertTrue(c.bound); assertEq(c.vectorsCount, 5); assertEq(c.vectorsDepth, 3);
    }

    function testFuzz_verdictOfRejectsAlteredBits(bytes8 other) public {
        (uint256 cid, bytes32[] memory leaves, address[] memory wallets) = _campaignReady();
        vm.assume(other != tBits[2]);
        bytes32[] memory p = PH.proof(leaves, 2);
        vm.expectRevert(CampaignCommit.NotInSnapshot.selector);
        campaigns.verdictOf(cid, 2, wallets[2], other, p);
    }

    function test_verdictOfRejectsWrongIndexAndPadding() public {
        (uint256 cid, bytes32[] memory leaves, address[] memory wallets) = _campaignReady();
        bytes32[] memory p = PH.proof(leaves, 2);
        vm.expectRevert(CampaignCommit.NotInSnapshot.selector);
        campaigns.verdictOf(cid, 3, wallets[2], tBits[2], p);             // proof of leaf 2 at position 3
        vm.expectRevert(CampaignCommit.NotInSnapshot.selector);
        campaigns.verdictOf(cid, 6, address(0), bytes8(0), PH.proof(leaves, 6));   // padding beyond count
    }

    /// An owner who declares fewer wallets than the tree holds cannot use the hidden extra leaf.
    function test_leafBeyondDeclaredCountIsRejected() public {
        (uint256 cid, uint256 modelId) = _committed();
        (bytes32[] memory leaves, address[] memory wallets) = _snap(6);
        _toPublish(cid);
        campaigns.publishVectors(cid, PH.root(leaves), 5, 3, "");   // 6 leaves in the tree, 5 declared
        campaigns.bind(cid, modelId);
        campaigns.verdictOf(cid, 4, wallets[4], tBits[4], PH.proof(leaves, 4));
        bytes32[] memory p5 = PH.proof(leaves, 5);
        vm.expectRevert(CampaignCommit.NotInSnapshot.selector);
        campaigns.verdictOf(cid, 5, wallets[5], tBits[5], p5);
    }

    function test_verdictOfNotReadyUntilBound() public {
        (uint256 cid,) = _committed();
        vm.expectRevert(CampaignCommit.NotBound.selector);
        campaigns.verdictOf(cid, 0, tWallet[0], tBits[0], new bytes32[](0));
    }

    /// Audit S3: one wallet listed twice is provable by anyone, and voids the campaign.
    function test_duplicateWalletInvalidatesCampaign() public {
        (uint256 cid, uint256 modelId) = _committed();
        bytes32[] memory leaves = new bytes32[](4);
        address w = tWallet[1];
        leaves[0] = keccak256(abi.encodePacked(uint32(0), tWallet[0], tBits[0]));
        leaves[1] = keccak256(abi.encodePacked(uint32(1), w, tBits[1]));
        leaves[2] = keccak256(abi.encodePacked(uint32(2), w, bytes8(0)));   // same wallet, "clean" bits
        leaves[3] = keccak256(abi.encodePacked(uint32(3), tWallet[3], tBits[3]));
        _toPublish(cid);
        campaigns.publishVectors(cid, PH.root(leaves), 4, 2, "");
        campaigns.bind(cid, modelId);
        vm.expectRevert(CampaignCommit.NotADuplicate.selector);
        campaigns.proveDuplicate(cid, w, 1, tBits[1], PH.proof(leaves, 1), 1, tBits[1], PH.proof(leaves, 1));
        vm.prank(address(0xCAFE));
        campaigns.proveDuplicate(cid, w, 1, tBits[1], PH.proof(leaves, 1), 2, bytes8(0), PH.proof(leaves, 2));
        assertTrue(campaigns.campaign(cid).invalid);
        vm.expectRevert(CampaignCommit.Invalid.selector);
        campaigns.verdictOf(cid, 0, tWallet[0], tBits[0], PH.proof(leaves, 0));
    }

    function test_proveDuplicateNeedsTwoDifferentPositionsOfOneWallet() public {
        (uint256 cid, bytes32[] memory leaves, address[] memory wallets) = _campaignReady();
        vm.expectRevert(CampaignCommit.NotADuplicate.selector);   // honest file: positions 1 and 2 are different wallets
        campaigns.proveDuplicate(cid, wallets[1], 1, tBits[1], PH.proof(leaves, 1), 2, tBits[2], PH.proof(leaves, 2));
    }

    function test_commitNeedsLeadTimeAndAnEarlierTestSet() public {
        uint256 tc = _commitTests(tLabel);
        vm.expectRevert(CampaignCommit.TestSetAfterCommit.selector);   // committed in this same block
        campaigns.commit(0, 0, uint64(block.number + LEAD), tc);
        vm.roll(block.number + 1);
        vm.expectRevert(CampaignCommit.SnapshotTooSoon.selector);
        campaigns.commit(0, 0, uint64(block.number + LEAD - 1), tc);
        uint256 a = campaigns.commit(0, 0, uint64(block.number + LEAD), tc);
        uint256 b = campaigns.commit(0, 0, uint64(block.number + LEAD + 5), tc);
        uint256[] memory mine = campaigns.campaignsOf(address(this));
        assertEq(mine.length, 2); assertEq(mine[0], a); assertEq(mine[1], b);
        assertEq(campaigns.campaign(a).testCommitId, tc);
    }

    function test_publishRules() public {
        (uint256 cid,) = _committed();
        (bytes32[] memory leaves,) = _snap(5);
        bytes32 root = PH.root(leaves);
        vm.expectRevert(CampaignCommit.BeforeSnapshot.selector);
        campaigns.publishVectors(cid, root, 5, 3, "");
        _toPublish(cid);
        vm.prank(address(0xBAD));
        vm.expectRevert(CampaignCommit.NotOwner.selector);
        campaigns.publishVectors(cid, root, 5, 3, "");
        vm.expectRevert(CampaignCommit.BadTree.selector);
        campaigns.publishVectors(cid, bytes32(0), 5, 3, "");      // zero root
        vm.expectRevert(CampaignCommit.BadTree.selector);
        campaigns.publishVectors(cid, root, 5, 4, "");            // depth too large for 5 leaves
        vm.expectRevert(CampaignCommit.BadTree.selector);
        campaigns.publishVectors(cid, root, 9, 3, "");            // more leaves than 2^depth
        campaigns.publishVectors(cid, root, 5, 3, "");
        vm.expectRevert(CampaignCommit.AlreadyPublished.selector);
        campaigns.publishVectors(cid, root, 5, 3, "");
    }

    function test_publishWindowCloses() public {
        (uint256 cid,) = _committed();
        (bytes32[] memory leaves,) = _snap(5);
        vm.roll(uint256(campaigns.campaign(cid).snapshotBlock) + campaigns.PUBLISH_WINDOW() + 1);
        vm.expectRevert(CampaignCommit.PublishWindowClosed.selector);
        campaigns.publishVectors(cid, PH.root(leaves), 5, 3, "");
    }

    function test_bindRules() public {
        (uint256 cid, uint256 modelId) = _committed();
        vm.expectRevert(CampaignCommit.NotPublished.selector);
        campaigns.bind(cid, modelId);
        (bytes32[] memory leaves,) = _snap(5);
        _toPublish(cid);
        campaigns.publishVectors(cid, PH.root(leaves), 5, 3, "");
        vm.prank(address(0xBAD));
        vm.expectRevert(CampaignCommit.NotOwner.selector);
        campaigns.bind(cid, modelId);
        campaigns.bind(cid, modelId);
        vm.expectRevert(CampaignCommit.AlreadyBound.selector);
        campaigns.bind(cid, modelId);
    }

    function _publishedCampaign(bytes32 netlistHash, bytes32 ext, uint256 tc) internal returns (uint256 cid) {
        cid = campaigns.commit(netlistHash, ext, uint64(block.number + LEAD), tc);
        (bytes32[] memory leaves,) = _snap(5);
        _toPublish(cid);
        campaigns.publishVectors(cid, PH.root(leaves), 5, 3, "");
    }

    function test_bindRejectsDifferentNetlist() public {
        (uint256 tc, uint256 modelId) = _register();
        vm.roll(block.number + 1);
        uint256 cid = _publishedCampaign(sha256("another netlist"), EXT, tc);
        vm.expectRevert(CampaignCommit.NetlistMismatch.selector);
        campaigns.bind(cid, modelId);
    }

    function test_bindRejectsDifferentExtractor() public {
        (uint256 tc, uint256 modelId) = _register();
        vm.roll(block.number + 1);
        uint256 cid = _publishedCampaign(sha256(netlistBytes), keccak256("other extractor"), tc);
        vm.expectRevert(CampaignCommit.ExtractorMismatch.selector);
        campaigns.bind(cid, modelId);
    }

    /// Audit H-2: the campaign pins the test set (e.g. one committed by the project, not the model's author).
    function test_bindRejectsAModelScoredOnAnotherTestSet() public {
        vm.prank(address(0x9A0));                        // an independent party commits the test set
        uint256 independent = _commitTests(tLabel);
        (, uint256 modelId) = _register();               // the model's author registered with their own set
        vm.roll(block.number + 1);
        uint256 cid = _publishedCampaign(sha256(netlistBytes), EXT, independent);
        vm.expectRevert(CampaignCommit.TestSetMismatch.selector);
        campaigns.bind(cid, modelId);
    }

    function test_bindWindowCloses() public {
        (uint256 tc, uint256 modelId) = _register();
        vm.roll(block.number + 1);
        uint256 cid = _publishedCampaign(sha256(netlistBytes), EXT, tc);
        vm.roll(uint256(campaigns.campaign(cid).snapshotBlock) + campaigns.BIND_WINDOW() + 1);
        vm.expectRevert(CampaignCommit.BindWindowClosed.selector);
        campaigns.bind(cid, modelId);
    }

    // ---------------------------------------------------------------- audit

    function test_constructorRejectsBadK() public {
        vm.expectRevert(AccuracyAudit.BadK.selector);
        new AccuracyAudit(0);
        vm.expectRevert(AccuracyAudit.BadK.selector);
        new AccuracyAudit(65);
        new AccuracyAudit(64);
    }

    /// Audit M-4: a round can be finalized in batches (each far below a 16.8M per-tx gas cap) and scores the same.
    function test_finalizeInBatches() public {
        (, uint256 modelId) = _register(_mixed());
        uint256 r = audit.requestAudit(modelId);
        _ready(r);
        (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) = _rows(r, _mixed());
        uint16 expect;
        for (uint256 j; j < K; ++j) if (tModel[rows[j].index] == _mixed()[rows[j].index]) ++expect;
        AccuracyAudit.Row[] memory a = new AccuracyAudit.Row[](1); bytes32[][] memory pa = new bytes32[][](1);
        a[0] = rows[0]; pa[0] = proofs[0];
        (, uint16 scored) = audit.finalizeAudit(r, a, pa);
        assertEq(scored, 1); assertEq(uint8(audit.status(r)), uint8(AccuracyAudit.Status.Ready));
        if (rows[0].index != rows[1].index) {   // sample 0's row resent as sample 1 (when they differ)
            vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.WrongRow.selector, 1, rows[1].index));
            audit.finalizeAudit(r, a, pa);
        }
        AccuracyAudit.Row[] memory b = new AccuracyAudit.Row[](K - 1); bytes32[][] memory pb = new bytes32[][](K - 1);
        for (uint256 j = 1; j < K; ++j) { b[j - 1] = rows[j]; pb[j - 1] = proofs[j]; }
        (uint16 correct, uint16 s2) = audit.finalizeAudit(r, b, pb);
        assertEq(s2, K); assertEq(correct, expect);
        assertEq(uint8(audit.status(r)), uint8(AccuracyAudit.Status.Done));
        (, , , , , uint16 c, uint16 tot,) = audit.rounds(r);
        assertEq(c, expect); assertEq(tot, K);
    }

    /// Audit H-1: a commit that claims more rows than its tree holds is voided by anyone, and can't freeze audits.
    function test_overstatedSizeIsVoided() public {
        bytes32[] memory leaves = _testLeaves(tLabel);            // 11 rows, depth 4
        uint256 tc = audit.commitTestSet(PH.root(leaves), 4, 16); // claims 16
        vm.roll(block.number + 1);
        uint256 modelId = registry.register(address(proc), circuitId, EXT, tc, "");
        uint256 r = audit.requestAudit(modelId);
        vm.expectRevert(AccuracyAudit.NotEmpty.selector);
        audit.proveEmptyRow(tc, 3, PH.proof(leaves, 3));          // a real row is not empty
        bytes32[] memory padded = new bytes32[](16);
        for (uint256 i; i < 11; ++i) padded[i] = leaves[i];
        vm.prank(address(0xF00));
        audit.proveEmptyRow(tc, 12, PH.proof(padded, 12));
        (, , , , , bool invalid) = audit.testCommits(tc);
        assertTrue(invalid);
        assertEq(uint8(audit.status(r)), uint8(AccuracyAudit.Status.Void));
        vm.expectRevert(AccuracyAudit.TestSetVoid.selector);
        audit.requestAudit(modelId);
        vm.expectRevert(AccuracyAudit.NotEmpty.selector);
        audit.proveEmptyRow(tc, 17, PH.proof(padded, 1));         // beyond size: not a claim the commit made
    }

    /// The padding of an honest commit (positions >= size) is empty by design: it must not void the commit.
    function test_honestPaddingCannotVoid() public {
        bytes32[] memory leaves = _testLeaves(tLabel);            // 11 rows, depth 4: positions 11..15 are padding
        uint256 tc = _commitTests(tLabel);
        bytes32[] memory padded = new bytes32[](16);
        for (uint256 i; i < 11; ++i) padded[i] = leaves[i];
        vm.expectRevert(AccuracyAudit.NotEmpty.selector);
        audit.proveEmptyRow(tc, 12, PH.proof(padded, 12));
        (, , , , , bool invalid) = audit.testCommits(tc);
        assertFalse(invalid);
    }

    function test_roundsAreListedPerModelAndTargetTheNextBlock() public {
        (, uint256 modelId) = _register();
        uint256 r0 = audit.requestAudit(modelId);
        (, , uint64 target,,,,,) = audit.rounds(r0);
        assertEq(target, block.number + 1);
        assertEq(uint8(audit.status(r0)), uint8(AccuracyAudit.Status.Pending));
        vm.roll(target);
        assertEq(uint8(audit.status(r0)), uint8(AccuracyAudit.Status.Pending));   // at the target block itself
        vm.roll(uint256(target) + 1);
        vm.setBlockhash(target, keccak256("h"));
        assertEq(uint8(audit.status(r0)), uint8(AccuracyAudit.Status.Ready));
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.RoundOpen.selector, r0));
        audit.requestAudit(modelId);                                              // a Ready round blocks too
        vm.roll(uint256(target) + 256);
        assertEq(uint8(audit.status(r0)), uint8(AccuracyAudit.Status.Ready));    // last block with a readable hash
        vm.roll(uint256(target) + 257);
        assertEq(uint8(audit.status(r0)), uint8(AccuracyAudit.Status.Expired));
        uint256 r1 = audit.requestAudit(modelId);
        uint256[] memory list = audit.roundsOfModel(modelId);
        assertEq(list.length, 2); assertEq(list[0], r0); assertEq(list[1], r1);
    }

    function test_roundIdSaltsTheDraw() public {
        // two rounds sharing a target block hash must still draw different rows
        (, uint256 m1) = _register();
        RefProcessor p2 = new RefProcessor(); factory.add(address(p2));
        bytes memory other = vm.parseJsonBytes(vm.readFile("../build/cusity.netlist.json"), ".netlist");
        uint256 c2 = p2.tapeout(other, 64, 7);
        uint256 tc2 = _commitTests(tLabel);
        vm.roll(block.number + 1);
        uint256 m2 = registry.register(address(p2), c2, EXT, tc2, "");
        uint256 ra = audit.requestAudit(m1); uint256 rb = audit.requestAudit(m2);
        _ready(ra);
        (, , uint64 tb,,,,,) = audit.rounds(rb);
        (, , uint64 ta,,,,,) = audit.rounds(ra);
        assertEq(ta, tb);
        uint32[] memory ia = audit.sampleIndices(ra); uint32[] memory ib = audit.sampleIndices(rb);
        bool differ;
        for (uint256 j; j < K; ++j) if (ia[j] != ib[j]) differ = true;
        assertTrue(differ);
    }

    function test_setRegistryLocksAndChecksBackPointer() public {
        vm.expectRevert(AccuracyAudit.Locked.selector);
        audit.setRegistry(address(registry));
        AccuracyAudit a2 = new AccuracyAudit(K);
        vm.expectRevert(AccuracyAudit.RegistryMismatch.selector);
        a2.setRegistry(address(registry));                       // registry points at `audit`, not a2
        vm.prank(address(0xBAD));
        vm.expectRevert(AccuracyAudit.Locked.selector);
        a2.setRegistry(address(registry));
    }

    function test_commitTestSetRules() public {
        bytes32 r = PH.root(_testLeaves(tLabel));
        vm.expectRevert(AccuracyAudit.TestSetTooSmall.selector);
        audit.commitTestSet(r, 2, 3);                             // 3 < K
        vm.expectRevert(AccuracyAudit.BadTree.selector);
        audit.commitTestSet(r, 3, 11);                            // 11 leaves don't fit depth 3
        vm.expectRevert(AccuracyAudit.BadTree.selector);
        audit.commitTestSet(r, 5, 11);                            // depth not the smallest
        vm.expectRevert(AccuracyAudit.BadTree.selector);
        audit.commitTestSet(bytes32(0), 4, 11);
        audit.commitTestSet(r, 4, 11);
    }

    function _scoreWith(bool[N] memory labels) internal returns (uint16 correct, uint16 expect) {
        (, uint256 modelId) = _register(labels);
        uint256 r = audit.requestAudit(modelId);
        _ready(r);
        (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) = _rows(r, labels);
        for (uint256 j; j < K; ++j) if (tModel[rows[j].index] == labels[rows[j].index]) ++expect;
        vm.prank(address(0xA11CE));   // anyone can finalize
        (correct,) = audit.finalizeAudit(r, rows, proofs);
        assertEq(uint8(audit.status(r)), uint8(AccuracyAudit.Status.Done));
    }

    function test_auditAllCorrectScoresK() public {
        (uint16 correct, uint16 expect) = _scoreWith(tLabel);
        assertEq(expect, K); assertEq(correct, K);
    }

    function test_auditAllWrongScoresZero() public {
        (uint16 correct, uint16 expect) = _scoreWith(_flipped());
        assertEq(expect, 0); assertEq(correct, 0);
    }

    /// Audit S2: a leaf with the other label cannot be used at the same index.
    function test_swappedLabelIsRejected() public {
        (, uint256 modelId) = _register();
        uint256 r = audit.requestAudit(modelId);
        _ready(r);
        (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) = _rows(r, tLabel);
        rows[0].label = !rows[0].label;
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.BadProof.selector, 0));
        audit.finalizeAudit(r, rows, proofs);
    }

    function test_auditWrongRowReverts() public {
        (, uint256 modelId) = _register();
        uint256 r = audit.requestAudit(modelId);
        _ready(r);
        (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) = _rows(r, tLabel);
        uint32 want = rows[0].index;
        rows[0].index = uint32((want + 1) % N);
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.WrongRow.selector, 0, want));
        audit.finalizeAudit(r, rows, proofs);
        vm.expectRevert(AccuracyAudit.WrongRowCount.selector);
        audit.finalizeAudit(r, new AccuracyAudit.Row[](K - 1), proofs);      // rows and proofs differ in length
        vm.expectRevert(AccuracyAudit.WrongRowCount.selector);
        audit.finalizeAudit(r, new AccuracyAudit.Row[](0), new bytes32[][](0));
    }

    function testFuzz_auditRejectsAlteredRow(bytes8 other) public {
        (, uint256 modelId) = _register();
        uint256 r = audit.requestAudit(modelId);
        _ready(r);
        (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) = _rows(r, tLabel);
        vm.assume(other != rows[1].bits);
        rows[1].bits = other;
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.BadProof.selector, 1));
        audit.finalizeAudit(r, rows, proofs);
    }

    function test_cannotFinalizeTwiceOrEarly() public {
        (, uint256 modelId) = _register();
        uint256 r = audit.requestAudit(modelId);
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.NotReady.selector, AccuracyAudit.Status.Pending));
        audit.sampleIndex(r, 0);
        _ready(r);
        (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) = _rows(r, tLabel);
        audit.finalizeAudit(r, rows, proofs);
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.NotReady.selector, AccuracyAudit.Status.Done));
        audit.finalizeAudit(r, rows, proofs);
    }

    /// Audit S5: the requester is recorded, and a sealed round can be finalized long after 256 blocks.
    function test_sealKeepsRoundFinalizable() public {
        (, uint256 modelId) = _register();
        vm.prank(address(0x5EED));
        uint256 r = audit.requestAudit(modelId);
        (, address requester,,,,,,) = audit.rounds(r);
        assertEq(requester, address(0x5EED));
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.NotReady.selector, AccuracyAudit.Status.Pending));
        audit.seal(r);
        _ready(r);
        uint32[] memory before = audit.sampleIndices(r);
        vm.prank(address(0xF00));
        audit.seal(r);
        vm.roll(block.number + 10_000);
        assertEq(uint8(audit.status(r)), uint8(AccuracyAudit.Status.Ready));
        uint32[] memory later = audit.sampleIndices(r);
        for (uint256 j; j < K; ++j) assertEq(later[j], before[j]);
        (AccuracyAudit.Row[] memory rows, bytes32[][] memory proofs) = _rows(r, tLabel);
        (uint16 correct,) = audit.finalizeAudit(r, rows, proofs);
        assertEq(correct, K);
    }

    function test_unsealedRoundExpiresAndStaysVisible() public {
        (, uint256 modelId) = _register();
        uint256 r0 = audit.requestAudit(modelId);
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.RoundOpen.selector, r0));
        audit.requestAudit(modelId);
        vm.roll(block.number + 258);
        assertEq(uint8(audit.status(r0)), uint8(AccuracyAudit.Status.Expired));
        vm.expectRevert(abi.encodeWithSelector(AccuracyAudit.NotReady.selector, AccuracyAudit.Status.Expired));
        audit.seal(r0);
        uint256 r1 = audit.requestAudit(modelId);
        assertEq(r1, r0 + 1);
        assertEq(uint8(audit.status(r0)), uint8(AccuracyAudit.Status.Expired));
    }

    function test_unavailableHashCannotBeUsed() public {
        (, uint256 modelId) = _register();
        uint256 r = audit.requestAudit(modelId);
        (, , uint64 target,,,,,) = audit.rounds(r);
        vm.roll(uint256(target) + 1);
        vm.setBlockhash(target, bytes32(0));
        vm.expectRevert(AccuracyAudit.HashUnavailable.selector);
        audit.seal(r);
    }
}

/// Trees built by data/merkle_core.ts (TypeScript) must verify here (build/merkle_compat.json,
/// from scripts/merkle_compat.ts), through the same library the contracts use.
contract MerkleCompatTest is Test {
    function _verify(bytes32[] calldata p, bytes32 r, uint8 d, uint256 i, bytes32 l) external pure returns (bool) {
        return PositionalMerkleProbe.verify(p, r, d, i, l);
    }

    function test_proofShapeIsStrict() public view {
        bytes32[] memory leaves = new bytes32[](4);
        for (uint256 i; i < 4; ++i) leaves[i] = keccak256(abi.encode(i));
        bytes32 root = PH.root(leaves);
        bytes32[] memory p = PH.proof(leaves, 2);
        assertTrue(this._verify(p, root, 2, 2, leaves[2]));
        assertFalse(this._verify(p, root, 2, 2 + 4, leaves[2]), "index beyond 2^depth must fail");
        bytes32[] memory longer = new bytes32[](3);
        longer[0] = p[0]; longer[1] = p[1];
        assertFalse(this._verify(longer, root, 2, 2, leaves[2]), "proof longer than depth must fail");
        bytes32[] memory shorter = new bytes32[](1); shorter[0] = p[0];
        assertFalse(this._verify(shorter, root, 2, 2, leaves[2]), "proof shorter than depth must fail");
    }

    function test_tsTreesVerifyInSolidity() public view {
        string memory j = vm.readFile("../build/merkle_compat.json");
        bytes32 root = vm.parseJsonBytes32(j, ".test.root");
        uint8 depth = uint8(vm.parseJsonUint(j, ".test.depth"));
        for (uint256 i; i < vm.parseJsonUint(j, ".test.size"); ++i) {
            string memory p = string.concat(".test.rows[", vm.toString(i), "]");
            bytes32 leaf = keccak256(abi.encodePacked(uint32(i), vm.parseJsonAddress(j, string.concat(p, ".wallet")),
                bytes8(vm.parseJsonBytes(j, string.concat(p, ".bits"))), vm.parseJsonUint(j, string.concat(p, ".label")) == 1));
            assertEq(leaf, vm.parseJsonBytes32(j, string.concat(p, ".leaf")), "test leaf encoding differs");
            assertTrue(this._verify(vm.parseJsonBytes32Array(j, string.concat(p, ".proof")), root, depth, i, leaf), "test proof rejected");
        }
        root = vm.parseJsonBytes32(j, ".snapshot.root");
        depth = uint8(vm.parseJsonUint(j, ".snapshot.depth"));
        address prev;
        for (uint256 i; i < vm.parseJsonUint(j, ".snapshot.count"); ++i) {
            string memory p = string.concat(".snapshot.rows[", vm.toString(i), "]");
            address w = vm.parseJsonAddress(j, string.concat(p, ".wallet"));
            assertGt(uint160(w), uint160(prev), "snapshot not sorted");
            prev = w;
            bytes32 leaf = keccak256(abi.encodePacked(uint32(i), w, bytes8(vm.parseJsonBytes(j, string.concat(p, ".bits")))));
            assertTrue(this._verify(vm.parseJsonBytes32Array(j, string.concat(p, ".proof")), root, depth, i, leaf), "snapshot proof rejected");
        }
    }
}

import {PositionalMerkle} from "../src/PositionalMerkle.sol";
library PositionalMerkleProbe {
    function verify(bytes32[] calldata p, bytes32 r, uint8 d, uint256 i, bytes32 l) internal pure returns (bool) {
        return PositionalMerkle.verify(p, r, d, i, l);
    }
}
