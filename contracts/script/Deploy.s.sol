// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AccuracyAudit} from "../src/AccuracyAudit.sol";
import {CusityRegistry} from "../src/CusityRegistry.sol";
import {CampaignCommit} from "../src/CampaignCommit.sol";

/// Deploys the three contracts on X Layer mainnet, signing with a Foundry keystore (never a raw key):
///   cast wallet import cusity --interactive          # once; the key is stored encrypted
///   forge script script/Deploy.s.sol --rpc-url https://rpc.xlayer.tech --account cusity --broadcast
/// AUDIT_K (default 16, 1..64) = rows per audit round. Each row costs one eval (~2.7M gas at 1,194 gates);
/// rounds can be finalized in batches, so no single transaction needs more than a few rows.
contract Deploy is Script {
    /// TapeOut processor factory on X Layer (proxy; isCPU is true only for processors it created).
    address constant FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    /// Runtime code hashes of TapeOut's processor proxies. Both builds embed the same beacon
    /// (0xf70d1ed4…991c), whose owner is the zero address, so their evaluator can never change.
    bytes32 constant PROXY_A = 0x57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5; // e.g. #180, #300
    bytes32 constant PROXY_B = 0x8c799a18cd8e0d5f5f3c0cec4fbc145e2daf79f70c2b131c09d0f380921db545; // e.g. #419, #422

    function run() external returns (AccuracyAudit audit, CusityRegistry registry, CampaignCommit campaign) {
        uint256 kRaw = vm.envOr("AUDIT_K", uint256(16));
        require(kRaw > 0 && kRaw <= 64, "AUDIT_K must be 1..64");
        bytes32[] memory code = new bytes32[](2);
        code[0] = PROXY_A; code[1] = PROXY_B;
        vm.startBroadcast();
        audit = new AccuracyAudit(uint16(kRaw));
        registry = new CusityRegistry(address(audit), FACTORY, code);
        audit.setRegistry(address(registry));
        campaign = new CampaignCommit(address(registry));
        vm.stopBroadcast();
        console.log("AUDIT", address(audit));
        console.log("REGISTRY", address(registry));
        console.log("CAMPAIGN", address(campaign));
    }
}
