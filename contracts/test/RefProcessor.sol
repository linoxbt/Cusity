// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITapeOutProcessor} from "../src/ITapeOutProcessor.sol";

/// Test-only TAP-02 processor for NAND-only netlists: same numbering, packing and revert strings as the
/// live X Layer processor (checked Nov 18, 2026). Lets the contracts run against the real Cusity netlist
/// in unit tests, and gives a rough gas figure for eval.
contract RefProcessor is ITapeOutProcessor {
    struct Circuit { bytes netlist; uint32 nIn; uint32 nOut; }
    Circuit[] private _c;

    constructor() { _c.push(); }   // ids start at 1, like the live processors

    function tapeout(bytes calldata nl, uint32 nIn, uint32 nOut) external returns (uint256 id) {
        require(nl.length > 0 && nl.length % 7 == 0, "bad opcode");
        require(nOut > 0, "no outputs");
        uint256 n = nl.length / 7;
        require(nOut <= n, "outputs must be elements");
        for (uint256 g; g < n; ++g) {
            require(nl[g * 7] == 0x00, "bad opcode");
            uint256 own = 2 + nIn + g;
            require(_u24(nl, g * 7 + 1) < own && _u24(nl, g * 7 + 4) < own, "NAND: future signal");
        }
        id = _c.length;
        _c.push(Circuit(nl, nIn, nOut));
    }

    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) {
        Circuit storage c = _get(id);
        return (c.nIn, c.nOut, 0, uint32(c.netlist.length / 7));
    }

    function netlist(uint256 id) external view returns (bytes memory) { return _get(id).netlist; }

    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory out) {
        Circuit storage c = _get(id);
        bytes memory nl = c.netlist;
        uint256 nIn = c.nIn; uint256 nOut = c.nOut; uint256 n = nl.length / 7;
        require(inputs.length == (nIn + 7) / 8, "bad inputs");
        bytes memory s = new bytes(2 + nIn + n);
        s[1] = 0x01;
        for (uint256 i; i < nIn; ++i) s[2 + i] = bytes1((uint8(inputs[i >> 3]) >> (i & 7)) & 1);
        for (uint256 g; g < n; ++g) {
            uint256 a = _u24m(nl, g * 7 + 1); uint256 b = _u24m(nl, g * 7 + 4);
            s[2 + nIn + g] = bytes1(1 - (uint8(s[a]) & uint8(s[b])));
        }
        out = new bytes((nOut + 7) / 8);
        uint256 base = 2 + nIn + n - nOut;
        for (uint256 k; k < nOut; ++k) if (s[base + k] != 0) out[k >> 3] |= bytes1(uint8(1 << (k & 7)));
    }

    function _get(uint256 id) private view returns (Circuit storage c) {
        require(id != 0 && id < _c.length, "no circuit");
        c = _c[id];
    }
    function _u24(bytes calldata d, uint256 o) private pure returns (uint256) {
        return (uint256(uint8(d[o])) << 16) | (uint256(uint8(d[o + 1])) << 8) | uint8(d[o + 2]);
    }
    function _u24m(bytes memory d, uint256 o) private pure returns (uint256) {
        return (uint256(uint8(d[o])) << 16) | (uint256(uint8(d[o + 1])) << 8) | uint8(d[o + 2]);
    }
}
