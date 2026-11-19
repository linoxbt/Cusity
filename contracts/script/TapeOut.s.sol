// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

interface IProc {
    function tapeout(bytes calldata netlist, uint32 nIn, uint32 nOut) external payable returns (uint256 id);
    function netlist(uint256 id) external view returns (bytes memory);
    function transistorsContract() external view returns (address);
    function TAPEOUT_FEE() external view returns (uint256);
}
interface ITransistors {
    function mint(uint256 id, uint256 amount) external payable;
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function balanceOf(address, uint256) external view returns (uint256);
}
interface IERC20 { function approve(address, uint256) external returns (bool); function allowance(address, address) external view returns (uint256); function balanceOf(address) external view returns (uint256); }

/// Tapes out EXACTLY build/cusity.netlist.json (the bytes the model card hashes; no re-synthesis), then
/// checks the processor stores the same bytes. Same steps as test_fullFlowOnFork_cpu419, which it mirrors.
///   PROCESSOR=0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e forge script script/TapeOut.s.sol \
///     --rpc-url https://rpc.xlayer.tech --account cusity --broadcast
/// Dry-run first without --broadcast: it prints the fee plan. #419/#422 charge 0.0013 OKB + 0.01 BEM in total.
contract TapeOut is Script {
    address constant BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;   // protocol-fee token on newer processors

    function run() external returns (uint256 id) {
        IProc proc = IProc(vm.envOr("PROCESSOR", address(0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e)));
        string memory j = vm.readFile("../build/cusity.netlist.json");
        bytes memory nl = vm.parseJsonBytes(j, ".netlist");
        bytes32 want = vm.parseJsonBytes32(j, ".netlistSha256");
        require(sha256(nl) == want, "netlist bytes don't match their recorded sha256");
        uint256 gates = nl.length / 7;
        ITransistors t = ITransistors(proc.transistorsContract());
        uint256 price = t.mintPrice();
        // processors without a BEM fee (#180, #300) charge their per-gate protocol fee in OKB with the mint
        bool bem = vm.envOr("BEM_FEE", true);
        uint256 perGate = bem ? price : price + t.protocolFee();
        uint256 fee = proc.TAPEOUT_FEE();
        console.log("processor", address(proc), "gates", gates);
        console.log("mint price per gate (wei)", price, "tape-out fee (wei)", fee);
        vm.startBroadcast();
        (, address me,) = vm.readCallers();   // the account that signs (msg.sender of the broadcast calls)
        // newer processors (#419, #422) take a 0.01 BEM protocol fee (8 decimals) on mint; set BEM_FEE=false for #180/#300
        if (bem) require(IERC20(BEM).balanceOf(me) >= 1e6, "needs 0.01 BEM on X Layer for the protocol fee (bridge BEM from BNB Chain)");
        require(me.balance >= gates * perGate + fee, "not enough OKB for mint + fees + tape-out fee");
        if (bem && IERC20(BEM).allowance(me, address(t)) == 0) IERC20(BEM).approve(address(t), type(uint256).max);
        uint256 have = t.balanceOf(me, 0);
        if (have < gates) t.mint{value: (gates - have) * perGate}(0, gates - have);
        id = proc.tapeout{value: fee}(nl, 64, 7);
        vm.stopBroadcast();
        require(sha256(proc.netlist(id)) == want, "processor stores different bytes");
        console.log("taped out circuit id", id);
        console.logBytes32(want);
    }
}
