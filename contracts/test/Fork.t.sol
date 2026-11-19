// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {AccuracyAudit} from "../src/AccuracyAudit.sol";
import {CusityRegistry} from "../src/CusityRegistry.sol";
import {CampaignCommit} from "../src/CampaignCommit.sol";
import {PositionalHelper as PH} from "./PositionalHelper.sol";
import {RefProcessor} from "./RefProcessor.sol";

interface IProc {
    function tapeout(bytes calldata netlist, uint32 nIn, uint32 nOut) external payable returns (uint256 id);
    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32);
    function netlist(uint256 id) external view returns (bytes memory);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    function balanceOf(address) external view returns (uint256);
    function transistorsContract() external view returns (address);
    function TAPEOUT_FEE() external view returns (uint256);
}

interface IERC20Min {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IFactory {
    function createCPU(string calldata name, string calldata symbol, string calldata story, uint256 supply, uint256 price) external payable returns (address);
    function deployFee() external view returns (uint256);
    function cpuCount() external view returns (uint256);
    function cpuAt(uint256) external view returns (address);
}

interface ITransistors {
    function mint(uint256 id, uint256 amount) external payable;
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function balanceOf(address, uint256) external view returns (uint256);
    function minted() external view returns (uint256);
    function supplyCap() external view returns (uint256);
}

/// Fork tests against a live X Layer processor. Nothing is broadcast: everything runs on a local fork.
///   FORK=1 forge test --match-contract ForkTest -vv
contract ForkTest is Test {
    IProc constant P = IProc(0x9b826BD2984C2A041eE3b8f7168f2620fC5D3281);
    address constant ME = address(0xC051);

    function setUp() public {
        if (vm.envOr("FORK", uint256(0)) == 0) { vm.skip(true); return; }
        vm.createSelectFork(vm.envOr("XLAYER_RPC", string("https://rpc.xlayer.tech")));
    }

    function test_liveCircuitMatchesOurEvaluator() public view {
        assertEq(P.netlist(1), hex"000000020000030000000400000400000005000005");
        assertEq(P.eval(1, hex"03"), hex"00");
    }

    function _tapeoutOn(IProc proc) internal returns (uint256) { return _tapeoutOn(proc, "../build/toy.netlist.json", true); }

    function _tapeoutOn(IProc proc, string memory path, bool checkFixture) internal returns (uint256 id) {
        bytes memory nl = vm.parseJsonBytes(vm.readFile(path), ".netlist");
        uint256 gates = nl.length / 7;
        ITransistors t = ITransistors(proc.transistorsContract());
        uint256 price = t.mintPrice(); uint256 pfee = t.protocolFee(); uint256 tfee = proc.TAPEOUT_FEE();
        console.log("processor", address(proc));
        console.log("  mintPrice / protocolFee / TAPEOUT_FEE (wei):", price, pfee, tfee);
        console.log("  transistors minted / cap:", t.minted(), t.supplyCap());
        vm.deal(ME, 1000 ether);
        uint256 before = ME.balance;
        vm.startPrank(ME);
        // newer processors take the protocol fee in BEM (8 decimals) via transferFrom; give and approve some on the fork
        address BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
        deal(BEM, ME, 1e8);   // 1 BEM
        IERC20Min(BEM).approve(address(t), type(uint256).max);
        uint256 bemBefore = IERC20Min(BEM).balanceOf(ME);
        // try price + protocol fee per transistor first, then price only
        try t.mint{value: gates * (price + pfee)}(0, gates) {} catch { t.mint{value: gates * price}(0, gates); }
        console.log("  BEM spent (8 decimals):", bemBefore - IERC20Min(BEM).balanceOf(ME));
        console.log("  NAND transistors held:", t.balanceOf(ME, 0));
        id = proc.tapeout{value: tfee}(nl, 64, 7);
        vm.stopPrank();
        console.log("  taped out circuit id:", id);
        console.log("  total cost for", gates, "gates (wei):", before - ME.balance);
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 g) = proc.circuitInfo(id);
        assertEq(nIn, 64); assertEq(nOut, 7); assertEq(nState, 0); assertEq(g, gates);
        assertEq(proc.netlist(id), nl, "on-chain netlist bytes differ from ours");
        assertEq(sha256(proc.netlist(id)), vm.parseJsonBytes32(vm.readFile(path), ".netlistSha256"));
        if (!checkFixture) {
            uint256 g1 = gasleft(); proc.eval(id, hex"c00f00003f10ff01"); console.log("  live eval gas:", g1 - gasleft());
            return id;
        }
        string memory fx = vm.readFile("../build/fixture.json");
        for (uint256 i; i < 3; ++i) {
            string memory k = string.concat(".vectors[", vm.toString(i), "]");
            uint256 g0 = gasleft();
            bytes memory out = proc.eval(id, vm.parseJsonBytes(fx, string.concat(k, ".bits")));
            if (i == 0) console.log("  live eval gas:", g0 - gasleft());
            assertEq(uint8(out[0]) & 1, vm.parseJsonUint(fx, string.concat(k, ".verdict")), "verdict");
            assertEq((uint8(out[0]) >> 1) & 0x3f, vm.parseJsonUint(fx, string.concat(k, ".margin")), "margin");
        }
    }

    /// The current bot-filter circuit (build/cusity.netlist.json) on the same live processor.
    function test_tapeoutModelOnFork_cpu300() public { _tapeoutOn(IProc(0x9b826BD2984C2A041eE3b8f7168f2620fC5D3281), "../build/cusity.netlist.json", false); }

    /// Cheapest processors found by scanning all 430 (mint price ~0): the model circuit for ~0.0013 OKB.
    function test_tapeoutModelOnFork_cpu419() public { _tapeoutOn(IProc(0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e), "../build/cusity.netlist.json", false); }
    function test_tapeoutModelOnFork_cpu180() public { _tapeoutOn(IProc(0x7335a50819d44402e3D5E00239bBB80A13E7308F), "../build/cusity.netlist.json", false); }
    function test_tapeoutModelOnFork_cpu422() public { _tapeoutOn(IProc(0x550992f2dC407BfFDd82c516C0984dc5e00B37d3), "../build/cusity.netlist.json", false); }

    function test_tapeoutToyNetlistOnFork_cpu300() public { _tapeoutOn(IProc(0x9b826BD2984C2A041eE3b8f7168f2620fC5D3281)); }
    /// Own processor: on Nov 19, 2026 the upgraded factory refuses createCPU at its first check (no revert data),
    /// even with the deploy fee paid in OKB and BEM approved. Cusity uses existing processors (#419/#422); this
    /// test fails, on purpose, the day the route opens again so the cost table can be revisited.
    function test_ownProcessorRouteIsClosed() public {
        IFactory f = IFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
        vm.deal(ME, 10 ether);
        address BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
        deal(BEM, ME, 100e8);
        vm.startPrank(ME);
        IERC20Min(BEM).approve(address(f), type(uint256).max);
        (bool ok,) = address(f).call{value: f.deployFee()}(
            abi.encodeCall(IFactory.createCPU, ("Cusity", "CSTY", "Cusity bot filter circuits", 100000, 1e12)));
        vm.stopPrank();
        assertFalse(ok, "createCPU works again: re-evaluate an own processor");
    }

    /// Processor #427 lists a near-zero mint price; record why minting there fails (it is not usable as-is).
    function test_cpu427MintRevertReason() public {
        ITransistors t = ITransistors(IProc(0xc70d5367efa509cb151eC532Fe10e763Cb09a147).transistorsContract());
        vm.deal(ME, 1 ether);
        vm.prank(ME);
        (bool ok, bytes memory err) = address(t).call{value: 251 * (t.mintPrice() + t.protocolFee())}(abi.encodeCall(ITransistors.mint, (0, 251)));
        console.logBytes(err);
        assertFalse(ok, "cpu427 now accepts mints: re-check it as a cheaper processor");
    }

    // ------------------------------------------------------------------ the whole Cusity flow on mainnet state

    uint256 constant N = 40;     // test rows
    uint16 constant K = 16;      // rows per audit, as deployed

    /// Deploys the three contracts exactly as script/Deploy.s.sol does (real factory, real processor code
    /// hashes), tapes the model out on #419, then runs: test commit -> register -> campaign commit ->
    /// publish -> bind -> verdictOf -> requestAudit -> seal -> finalizeAudit (K=16), checking every result
    /// against the processor's own answers.
    function test_fullFlowOnFork_cpu419() public {
        IProc proc = IProc(0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e);
        uint256 cid = _tapeoutOn(proc, "../build/cusity.netlist.json", false);
        bytes32[] memory code = new bytes32[](2);
        code[0] = 0x57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5;
        code[1] = 0x8c799a18cd8e0d5f5f3c0cec4fbc145e2daf79f70c2b131c09d0f380921db545;
        AccuracyAudit audit = new AccuracyAudit(K);
        CusityRegistry reg = new CusityRegistry(address(audit), 0x1f09DAeFA827f02CBb40967cc91b259763760761, code);
        audit.setRegistry(address(reg));
        CampaignCommit camp = new CampaignCommit(address(reg));

        // test set: real-looking rows; every third label disagrees with the circuit
        bytes8[] memory bits = new bytes8[](N); bool[] memory label = new bool[](N); bool[] memory model = new bool[](N);
        bytes32[] memory leaves = new bytes32[](N);
        for (uint256 i; i < N; ++i) {
            bits[i] = bytes8(keccak256(abi.encode("fork row", i)));
            model[i] = uint8(proc.eval(cid, abi.encodePacked(bits[i]))[0]) & 1 == 1;
            label[i] = i % 3 == 0 ? !model[i] : model[i];
            leaves[i] = keccak256(abi.encodePacked(uint32(i), address(uint160(0xB000 + i)), bits[i], label[i]));
        }
        uint256 tc = audit.commitTestSet(PH.root(leaves), PH.depthFor(N), uint32(N));
        vm.roll(block.number + 1);
        bytes32 ext = keccak256("extractor");
        uint256 modelId = reg.register(address(proc), cid, ext, tc, "ipfs://card");
        assertEq(reg.model(modelId).netlistHash, vm.parseJsonBytes32(vm.readFile("../build/cusity.netlist.json"), ".netlistSha256"));

        // a contract that is not a factory processor is refused on mainnet state too
        RefProcessor fake = new RefProcessor();
        vm.expectRevert(CusityRegistry.NotATapeOutProcessor.selector);
        reg.register(address(fake), 1, ext, tc, "");

        // campaign over 5 wallets
        vm.roll(block.number + 1);
        uint256 c = camp.commit(reg.model(modelId).netlistHash, ext, uint64(block.number + 5));
        bytes32[] memory snap = new bytes32[](5);
        for (uint256 i; i < 5; ++i) snap[i] = keccak256(abi.encodePacked(uint32(i), address(uint160(0xC000 + i)), bits[i]));
        vm.roll(block.number + 6);
        camp.publishVectors(c, PH.root(snap), 5, PH.depthFor(5), "https://cusity/snapshot/list.json");
        camp.bind(c, modelId);
        for (uint256 i; i < 5; ++i) {
            uint256 g = gasleft();
            (bool v,) = camp.verdictOf(c, uint32(i), address(uint160(0xC000 + i)), bits[i], PH.proof(snap, i));
            if (i == 0) console.log("verdictOf gas (eth_call):", g - gasleft());
            assertEq(v, model[i]);
        }

        // audit
        uint256 r = audit.requestAudit(modelId);
        (, , uint64 target,,,,) = audit.rounds(r);
        vm.roll(uint256(target) + 1);
        vm.setBlockhash(target, keccak256("fork target hash"));
        audit.seal(r);
        vm.roll(block.number + 1000);   // long after the 256-block window: sealed rounds stay finalizable
        uint32[] memory idx = audit.sampleIndices(r);
        AccuracyAudit.Row[] memory rows = new AccuracyAudit.Row[](K);
        bytes32[][] memory proofs = new bytes32[][](K);
        uint16 expect;
        for (uint256 j; j < K; ++j) {
            uint32 i = idx[j];
            rows[j] = AccuracyAudit.Row(i, address(uint160(0xB000 + i)), bits[i], label[i]);
            proofs[j] = PH.proof(leaves, i);
            if (model[i] == label[i]) ++expect;
        }
        uint256 g0 = gasleft();
        (uint16 correct, uint16 total) = audit.finalizeAudit(r, rows, proofs);
        console.log("finalizeAudit gas, K=16 on the live processor:", g0 - gasleft());
        assertEq(correct, expect); assertEq(total, K);
        assertLt(expect, K);   // the mixed labels really were scored
    }
}
