// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {TapeOut} from "../script/TapeOut.s.sol";
import {Campaign} from "../script/Campaign.s.sol";
import {AccuracyAudit} from "../src/AccuracyAudit.sol";
import {CusityRegistry} from "../src/CusityRegistry.sol";
import {CampaignCommit} from "../src/CampaignCommit.sol";

interface IERC20Deal { function balanceOf(address) external view returns (uint256); }

/// The docs/ONCHAIN.md runbook, rehearsed on an X Layer mainnet fork by running the real scripts in order
/// (Deploy -> TapeOut -> Campaign test/register/commit/publish/bind), then checking real snapshot wallets
/// through verdictOf and scoring a K=16 audit on the real held-out test set.
///   FORK=1 forge test --match-contract RunbookTest -vv
contract RunbookTest is Test {
    function setUp() public {
        if (vm.envOr("FORK", uint256(0)) == 0) { vm.skip(true); return; }
        vm.createSelectFork(vm.envOr("XLAYER_RPC", string("https://rpc.xlayer.tech")));
    }

    function test_runbookOnFork() public {
        address signer = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;   // forge's default broadcaster in tests
        vm.deal(signer, 10 ether);
        vm.createDir("../build/tmp", true);   // gitignored, so absent in a fresh clone
        deal(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952, signer, 1e8);   // 1 BEM for the protocol fee
        (AccuracyAudit audit, CusityRegistry registry, CampaignCommit campaign) = new Deploy().run();
        vm.setEnv("AUDIT", vm.toString(address(audit))); vm.setEnv("REGISTRY", vm.toString(address(registry)));
        vm.setEnv("CAMPAIGN", vm.toString(address(campaign)));

        vm.setEnv("PROCESSOR", "0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e");
        uint256 circuitId = new TapeOut().run();
        console.log("taped out circuit", circuitId);

        vm.setEnv("STEP", "test");
        uint256 tc = new Campaign().run();
        vm.roll(block.number + 1);
        vm.setEnv("STEP", "register"); vm.setEnv("CIRCUIT_ID", vm.toString(circuitId));
        vm.setEnv("TEST_COMMIT_ID", vm.toString(tc)); vm.setEnv("CARD_URI", "https://cusity.vercel.app/model/model_card.json");
        uint256 modelId = new Campaign().run();
        vm.roll(block.number + 1);
        uint256 snap = block.number + 86_400;   // CampaignCommit.MIN_LEAD
        vm.setEnv("STEP", "commit"); vm.setEnv("SNAPSHOT_BLOCK", vm.toString(snap));
        uint256 cid = new Campaign().run();

        // via_ir may re-evaluate `block.number + 1000` after vm.roll, so take the block from the contract
        uint256 snapBlock = campaign.campaign(cid).snapshotBlock;
        // publish the real snapshot tree (the rehearsal index differs from the shipped one only in its block)
        vm.roll(snapBlock + 1);
        string memory idx = vm.readFile("../web/public/snapshot/index.json");
        string memory o = "idx";
        vm.serializeUint(o, "block", snapBlock);
        vm.serializeUint(o, "campaignId", cid);
        vm.serializeBytes32(o, "extractorHash", vm.parseJsonBytes32(idx, ".extractorHash"));
        vm.serializeBytes32(o, "root", vm.parseJsonBytes32(idx, ".root"));
        vm.serializeUint(o, "depth", vm.parseJsonUint(idx, ".depth"));
        vm.writeJson(vm.serializeUint(o, "count", vm.parseJsonUint(idx, ".count")), "../build/tmp/rehearsal_index.json");
        vm.setEnv("SNAPSHOT_INDEX", "../build/tmp/rehearsal_index.json");
        vm.setEnv("STEP", "publish"); vm.setEnv("CAMPAIGN_ID", vm.toString(cid)); vm.setEnv("VECTORS_URI", "https://cusity.vercel.app/snapshot/list.json");
        new Campaign().run();
        vm.setEnv("STEP", "bind"); vm.setEnv("MODEL_ID", vm.toString(modelId));
        new Campaign().run();
        assertTrue(campaign.campaign(cid).bound);

        // real snapshot wallets through verdictOf (proofs from the shipped shards)
        string memory sh = vm.readFile("../web/public/snapshot/00.json");
        string[] memory ws = vm.parseJsonKeys(sh, ".wallets");
        for (uint256 i; i < ws.length && i < 5; ++i) {
            string memory k = string.concat(".wallets.", ws[i]);
            uint32 index = uint32(vm.parseJsonUint(sh, string.concat(k, ".index")));
            bytes8 bits = bytes8(vm.parseJsonBytes(sh, string.concat(k, ".bits")));
            (bool v, uint8 m) = campaign.verdictOf(cid, index, vm.parseAddress(ws[i]), bits, vm.parseJsonBytes32Array(sh, string.concat(k, ".proof")));
            (bool v2, uint8 m2) = registry.check(modelId, bits);
            assertEq(v, v2); assertEq(m, m2);
        }

        // a K=16 audit on the real held-out test set
        uint256 bemBefore = IERC20Deal(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952).balanceOf(signer);
        console.log("signer BEM left (8 decimals)", bemBefore);
        uint256 r = audit.requestAudit(modelId);
        (, , uint64 target,,,,,) = audit.rounds(r);
        vm.roll(uint256(target) + 1);
        vm.setBlockhash(target, keccak256("rehearsal"));
        uint32[] memory sIdx = audit.sampleIndices(r);
        string memory tl = vm.readFile("../data/test_leaves.json");
        AccuracyAudit.Row[] memory rows = new AccuracyAudit.Row[](sIdx.length);
        bytes32[][] memory proofs = new bytes32[][](sIdx.length);
        uint16 expect;
        for (uint256 j; j < sIdx.length; ++j) {
            string memory p = string.concat(".leaves[", vm.toString(uint256(sIdx[j])), "]");
            rows[j] = AccuracyAudit.Row(sIdx[j], vm.parseJsonAddress(tl, string.concat(p, ".wallet")),
                bytes8(vm.parseJsonBytes(tl, string.concat(p, ".bits"))), vm.parseJsonUint(tl, string.concat(p, ".label")) == 1);
            proofs[j] = vm.parseJsonBytes32Array(tl, string.concat(p, ".proof"));
            (bool v,) = registry.check(modelId, rows[j].bits);
            if (v == rows[j].label) ++expect;
        }
        (uint16 correct, uint16 total) = audit.finalizeAudit(r, rows, proofs);
        console.log("real test-set audit score", correct, "/", total);
        assertEq(total, sIdx.length);
        assertEq(correct, expect);
    }
}
