// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

interface IOpener {
    function accountOf(address processor, uint256 id) external view returns (address);
    function isOpened(address processor, uint256 id) external view returns (bool);
    function open(address processor, uint256 id) external payable returns (address);
    function FEE() external view returns (uint256);
}
interface ISiteRegistry {
    function fileInfo(address, string calldata) external view returns (uint32 size, string memory contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount);
    function pathCount(address) external view returns (uint256);
    function pathsRange(address, uint256, uint256) external view returns (string[] memory);
    function putFile(address, string calldata, string calldata, bytes32, bytes calldata) external;
    function appendChunk(address, string calldata, uint256, bytes calldata) external;
    function removeFile(address, string calldata) external;
    function read(address, string calldata) external view returns (bytes memory);
}
interface IDomainBinding {
    function monthlyFee() external view returns (uint256);
    function isContainerLive(address) external view returns (bool);
    function bind(string calldata name, address container, uint256 months) external payable;
}
interface IFactoryIndex { function cpuAt(uint256) external view returns (address); }
interface IOwnable721 { function ownerOf(uint256) external view returns (address); }

/// Publishes build/deweb (scripts/deweb_build.sh) to DeWEB: the site's files go into the circuit's container
/// through TapeOut's SiteRegistry, in 24,000-byte chunks, and the name <circuit>.2.<processor#>.tape is bound.
/// Same contracts and steps as `tapesynth publish`, but signed with a Foundry keystore, never a raw key.
/// Only files whose size or sha256 changed are written; files no longer in the build are removed.
///   PROCESSOR=0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e PROCESSOR_NUMBER=419 CIRCUIT_ID=<id> \
///     forge script script/Publish.s.sol --rpc-url https://rpc.xlayer.tech --account cusity --broadcast
/// Dry-run first (no --broadcast) to see what will be written. The signer must hold circuit <id>.
contract Publish is Script {
    IOpener constant OPENER = IOpener(0x536adD8F30f03b69f6fbF29d425A816A0dC50106);
    ISiteRegistry constant REGISTRY = ISiteRegistry(0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6);
    IDomainBinding constant BINDING = IDomainBinding(0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9);
    IFactoryIndex constant FACTORY = IFactoryIndex(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    uint256 constant CHUNK = 24_000;

    struct SiteFile { string contentType; string path; bytes32 sha256; uint256 size; }   // keys in alphabetical order

    function _slice(bytes memory b, uint256 from, uint256 to) private pure returns (bytes memory out) {
        if (to > b.length) to = b.length;
        out = new bytes(to - from);
        for (uint256 i; i < out.length; ++i) out[i] = b[from + i];
    }

    function files(string memory dir) public view returns (SiteFile[] memory) {
        return abi.decode(vm.parseJson(vm.readFile(string.concat(dir, "/.manifest.json")), ".files"), (SiteFile[]));
    }

    function run() external returns (address container, string memory name) {
        address proc = vm.envAddress("PROCESSOR");
        uint256 id = vm.envUint("CIRCUIT_ID");
        uint256 pnum = vm.envUint("PROCESSOR_NUMBER");
        uint256 months = vm.envOr("MONTHS", uint256(6));
        string memory dir = vm.envOr("SITE_DIR", string("../build/deweb"));
        require(FACTORY.cpuAt(pnum) == proc, "PROCESSOR_NUMBER is not this processor's index in the factory");
        SiteFile[] memory fs = files(dir);
        container = OPENER.accountOf(proc, id);
        name = string.concat(vm.toString(id), ".2.", vm.toString(pnum), ".tape");

        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        require(IOwnable721(proc).ownerOf(id) == me, "the signer does not hold this circuit");
        if (!OPENER.isOpened(proc, id)) { OPENER.open{value: OPENER.FEE()}(proc, id); console.log("opened container", container); }

        uint256 written;
        uint256 chunks;
        for (uint256 i; i < fs.length; ++i) {
            SiteFile memory f = fs[i];
            (uint32 size,, bytes32 sha, , uint256 count) = REGISTRY.fileInfo(container, f.path);
            if (count > 0 && sha == f.sha256 && size == f.size) continue;   // already on chain, unchanged
            bytes memory b = vm.readFileBinary(string.concat(dir, "/", f.path));
            require(b.length == f.size && sha256(b) == f.sha256, string.concat("file changed since the manifest was built: ", f.path));
            console.log(string.concat("[", vm.toString(i + 1), "/", vm.toString(fs.length), "] ", f.path, " (", vm.toString(b.length), " B)"));
            REGISTRY.putFile(container, f.path, f.contentType, f.sha256, _slice(b, 0, CHUNK));
            uint256 n = b.length == 0 ? 1 : (b.length + CHUNK - 1) / CHUNK;
            for (uint256 c = 1; c < n; ++c) REGISTRY.appendChunk(container, f.path, c, _slice(b, c * CHUNK, (c + 1) * CHUNK));
            ++written; chunks += n;
        }
        // remove files that are on chain but no longer in the build
        uint256 total = REGISTRY.pathCount(container);
        string[] memory onChain = total == 0 ? new string[](0) : REGISTRY.pathsRange(container, 0, total);
        for (uint256 i; i < onChain.length; ++i) {
            bool keep;
            for (uint256 j; j < fs.length && !keep; ++j) keep = keccak256(bytes(onChain[i])) == keccak256(bytes(fs[j].path));
            if (!keep) REGISTRY.removeFile(container, onChain[i]);
        }
        if (!BINDING.isContainerLive(container)) BINDING.bind{value: months * BINDING.monthlyFee()}(name, container, months);
        vm.stopBroadcast();
        console.log("files written", written, "chunks", chunks);
        console.log(string.concat("published: https://", vm.toString(id), "-2-", vm.toString(pnum), ".tapekit.org/  tape://", name, "/"));
    }
}
