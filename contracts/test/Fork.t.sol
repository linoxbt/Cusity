// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";

interface IProc {
    function tapeout(bytes calldata netlist, uint32 nIn, uint32 nOut) external payable returns (uint256 id);
    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32);
    function netlist(uint256 id) external view returns (bytes memory);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    function balanceOf(address) external view returns (uint256);
    function transistorsContract() external view returns (address);
    function TAPEOUT_FEE() external view returns (uint256);
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

    function _tapeoutOn(IProc proc) internal { _tapeoutOn(proc, "../build/toy.netlist.json", true); }

    function _tapeoutOn(IProc proc, string memory path, bool checkFixture) internal {
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
        // try price + protocol fee per transistor first, then price only
        try t.mint{value: gates * (price + pfee)}(0, gates) {} catch { t.mint{value: gates * price}(0, gates); }
        console.log("  NAND transistors held:", t.balanceOf(ME, 0));
        uint256 id = proc.tapeout{value: tfee}(nl, 64, 7);
        vm.stopPrank();
        console.log("  taped out circuit id:", id);
        console.log("  total cost for", gates, "gates (wei):", before - ME.balance);
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 g) = proc.circuitInfo(id);
        assertEq(nIn, 64); assertEq(nOut, 7); assertEq(nState, 0); assertEq(g, gates);
        assertEq(proc.netlist(id), nl, "on-chain netlist bytes differ from ours");
        assertEq(sha256(proc.netlist(id)), vm.parseJsonBytes32(vm.readFile(path), ".netlistSha256"));
        if (!checkFixture) {
            uint256 g1 = gasleft(); proc.eval(id, hex"c00f00003f10ff01"); console.log("  live eval gas:", g1 - gasleft());
            return;
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

    /// The real v1 bot-filter circuit (build/cusity.netlist.json) on the same live processor.
    function test_tapeoutV1OnFork_cpu300() public { _tapeoutOn(IProc(0x9b826BD2984C2A041eE3b8f7168f2620fC5D3281), "../build/cusity.netlist.json", false); }

    function test_tapeoutToyNetlistOnFork_cpu300() public { _tapeoutOn(IProc(0x9b826BD2984C2A041eE3b8f7168f2620fC5D3281)); }
    /// Own processor: created through the live factory on the fork, at the current (near-zero) price cap.
    function test_ownProcessorOnFork() public {
        IFactory f = IFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
        vm.deal(ME, 10 ether);
        uint256 before = ME.balance;
        vm.prank(ME);
        (bool ok, bytes memory ret) = address(f).call{value: f.deployFee()}(
            abi.encodeCall(IFactory.createCPU, ("Cusity", "CSTY", "Cusity bot filter circuits", 100000, 1e12)));
        if (!ok) { console.log("createCPU reverted:"); console.logBytes(ret); return; }
        address cpu = ret.length >= 32 ? abi.decode(ret, (address)) : f.cpuAt(f.cpuCount() - 1);
        console.log("created processor on fork:", cpu, "deploy cost (wei):", before - ME.balance);
        _tapeoutOn(IProc(cpu));
    }

    /// Processor #427 lists a near-zero mint price; record why minting there fails (it is not usable as-is).
    function test_cpu427MintRevertReason() public {
        ITransistors t = ITransistors(IProc(0xc70d5367efa509cb151eC532Fe10e763Cb09a147).transistorsContract());
        vm.deal(ME, 1 ether);
        vm.prank(ME);
        (bool ok, bytes memory err) = address(t).call{value: 251 * (t.mintPrice() + t.protocolFee())}(abi.encodeCall(ITransistors.mint, (0, 251)));
        console.log("cpu427 mint ok?", ok);
        if (!ok) console.logBytes(err);
    }
}
