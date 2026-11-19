// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AccuracyAudit} from "../src/AccuracyAudit.sol";
import {CusityRegistry} from "../src/CusityRegistry.sol";
import {CampaignCommit} from "../src/CampaignCommit.sol";

/// Every campaign transaction, read from the committed artifacts (nothing typed by hand) and signed with a
/// Foundry keystore. Run one STEP at a time, in this order, dry-run first (drop --broadcast):
///   STEP=test     data/test_leaves.json            -> AccuracyAudit.commitTestSet(root, depth, size)
///   STEP=commit   build/model_card.json + SNAPSHOT_BLOCK -> CampaignCommit.commit(netlistHash, extractorHash, block)
///   STEP=register PROCESSOR, CIRCUIT_ID, TEST_COMMIT_ID, CARD_URI -> CusityRegistry.register(...)
///   STEP=publish  web/public/snapshot/index.json + CAMPAIGN_ID, VECTORS_URI -> CampaignCommit.publishVectors(...)
///   STEP=bind     CAMPAIGN_ID, MODEL_ID          -> CampaignCommit.bind(...)
/// with AUDIT, REGISTRY, CAMPAIGN set to the addresses Deploy.s.sol printed:
///   STEP=test forge script script/Campaign.s.sol --rpc-url https://rpc.xlayer.tech --account cusity --broadcast
contract Campaign is Script {
    function run() external returns (uint256 id) {
        string memory step = vm.envString("STEP");
        bytes32 s = keccak256(bytes(step));
        vm.startBroadcast();
        if (s == keccak256("test")) {
            string memory j = vm.readFile("../data/test_leaves.json");
            id = AccuracyAudit(vm.envAddress("AUDIT")).commitTestSet(
                vm.parseJsonBytes32(j, ".root"), uint8(vm.parseJsonUint(j, ".depth")), uint32(vm.parseJsonUint(j, ".size")));
            console.log("TEST_COMMIT_ID", id);
        } else if (s == keccak256("commit")) {
            string memory c = vm.readFile("../build/model_card.json");
            uint64 snap = uint64(vm.envUint("SNAPSHOT_BLOCK"));
            require(snap > block.number + 600, "pick a snapshot block at least ~10 minutes ahead");
            id = CampaignCommit(vm.envAddress("CAMPAIGN")).commit(
                vm.parseJsonBytes32(c, ".netlistSha256"), vm.parseJsonBytes32(c, ".extractorSha256"), snap);
            console.log("CAMPAIGN_ID", id);
        } else if (s == keccak256("register")) {
            string memory c = vm.readFile("../build/model_card.json");
            id = CusityRegistry(vm.envAddress("REGISTRY")).register(vm.envAddress("PROCESSOR"), vm.envUint("CIRCUIT_ID"),
                vm.parseJsonBytes32(c, ".extractorSha256"), vm.envUint("TEST_COMMIT_ID"), vm.envString("CARD_URI"));
            console.log("MODEL_ID", id);
        } else if (s == keccak256("publish")) {
            string memory i = vm.readFile(vm.envOr("SNAPSHOT_INDEX", string("../web/public/snapshot/index.json")));
            CampaignCommit cc = CampaignCommit(vm.envAddress("CAMPAIGN"));
            uint256 cid = vm.envUint("CAMPAIGN_ID");
            require(vm.parseJsonUint(i, ".block") == cc.campaign(cid).snapshotBlock, "snapshot files were extracted at another block");
            require(vm.parseJsonBytes32(i, ".extractorHash") == cc.campaign(cid).extractorHash, "snapshot extracted with another extractor");
            cc.publishVectors(cid, vm.parseJsonBytes32(i, ".root"), uint32(vm.parseJsonUint(i, ".count")),
                uint8(vm.parseJsonUint(i, ".depth")), vm.envString("VECTORS_URI"));
        } else if (s == keccak256("bind")) {
            CampaignCommit(vm.envAddress("CAMPAIGN")).bind(vm.envUint("CAMPAIGN_ID"), vm.envUint("MODEL_ID"));
            console.log("bound");
        } else revert("STEP must be test | commit | register | publish | bind");
        vm.stopBroadcast();
    }
}
