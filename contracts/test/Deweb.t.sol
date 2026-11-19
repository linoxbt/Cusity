// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {TapeOut} from "../script/TapeOut.s.sol";
import {Publish, ISiteRegistry, IDomainBinding} from "../script/Publish.s.sol";

/// The DeWEB publish, rehearsed on an X Layer mainnet fork with the real Opener, SiteRegistry and DomainBinding:
/// tape out on #419, publish build/deweb, then read every file back from the registry and check its sha256.
///   scripts/deweb_build.sh && FORK=1 forge test --match-contract DewebTest -vv
contract DewebTest is Test {
    ISiteRegistry constant REGISTRY = ISiteRegistry(0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6);
    IDomainBinding constant BINDING = IDomainBinding(0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9);

    function setUp() public {
        if (vm.envOr("FORK", uint256(0)) == 0) { vm.skip(true); return; }
        vm.createSelectFork(vm.envOr("XLAYER_RPC", string("https://rpc.xlayer.tech")));
        if (!vm.exists("../build/deweb/.manifest.json")) { console.log("run scripts/deweb_build.sh first"); vm.skip(true); }
    }

    function test_publishSiteOnFork() public {
        address signer = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;   // forge's default broadcaster in tests
        vm.deal(signer, 10 ether);
        deal(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952, signer, 1e8);
        vm.setEnv("PROCESSOR", "0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e");
        uint256 id = new TapeOut().run();
        vm.setEnv("CIRCUIT_ID", vm.toString(id)); vm.setEnv("PROCESSOR_NUMBER", "419");

        uint256 before = signer.balance;
        uint256 g0 = gasleft();
        Publish pub = new Publish();
        (address container, string memory name) = pub.run();
        uint256 gasUsed = g0 - gasleft();
        console.log("site", name, "container", container);
        console.log("OKB paid (fees, excluding gas):", before - signer.balance);
        console.log("gas for the whole publish:", gasUsed);
        assertTrue(BINDING.isContainerLive(container), "name not live");

        Publish.SiteFile[] memory fs = pub.files("../build/deweb");
        assertEq(REGISTRY.pathCount(container), fs.length);
        for (uint256 i; i < fs.length; ++i) {
            bytes memory b = REGISTRY.read(container, fs[i].path);
            assertEq(b.length, fs[i].size, fs[i].path);
            assertEq(sha256(b), fs[i].sha256, fs[i].path);
        }
        console.log("files read back from chain and verified:", fs.length);

        // a second run changes nothing (everything is already on chain)
        uint256 g1 = gasleft();
        pub.run();
        console.log("gas for an unchanged re-publish:", g1 - gasleft());
    }
}
