// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AccuracyAudit} from "../src/AccuracyAudit.sol";
import {CusityRegistry} from "../src/CusityRegistry.sol";
import {CampaignCommit} from "../src/CampaignCommit.sol";

/// forge script script/Deploy.s.sol --rpc-url $XLAYER_RPC --broadcast
/// AUDIT_K (default 16) = rows per audit round; lower it if eval gas on the real processor is too high.
contract Deploy is Script {
    function run() external {
        uint16 k = uint16(vm.envOr("AUDIT_K", uint256(16)));
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        AccuracyAudit audit = new AccuracyAudit(k);
        CusityRegistry registry = new CusityRegistry(address(audit));
        audit.setRegistry(address(registry));
        CampaignCommit campaign = new CampaignCommit(address(registry));
        vm.stopBroadcast();
        console.log("AUDIT", address(audit));
        console.log("REGISTRY", address(registry));
        console.log("CAMPAIGN", address(campaign));
    }
}
