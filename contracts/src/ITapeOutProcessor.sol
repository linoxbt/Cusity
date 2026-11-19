// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Processor functions from the TAP-02 draft. circuitInfo, netlist and eval were checked against a
/// live X Layer processor (beacon proxy) on Nov 18, 2026: eval on a latch circuit reverts with
/// "has latch: use step", and an unknown id reverts with "no circuit".
interface ITapeOutProcessor {
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function netlist(uint256 id) external view returns (bytes memory);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
}

/// TapeOut's processor factory on X Layer (0x1f09daefa827f02cbb40967cc91b259763760761): isCPU(address)
/// is true only for processors it created.
interface ITapeOutFactory {
    function isCPU(address processor) external view returns (bool);
}
