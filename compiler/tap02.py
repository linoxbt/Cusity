"""Bit-exact TAP-02 evaluator for NAND-only netlists (no LATCH, no REF).

Signals: 0 = const 0, 1 = const 1, 2+i = input i, then one signal per record in order.
Outputs are the last nOut signals. Bits are packed LSB-first: bit i -> byte i//8, bit i%8.
Checked against eval() on a live X Layer processor (Nov 18, 2026).
"""
import hashlib, json


def load_netlist_hex(path):
    t = json.load(open(path))
    for k in ("netlist", "netlistHex", "bytes", "hex"):   # VERIFY TapeSynth's field name with `./tapesynth info`
        if k in t: return t[k]
    raise KeyError(f"netlist bytes not found in {path}")


def parse(hexstr, n_in=None):
    nl = bytes.fromhex(hexstr.removeprefix("0x"))
    if len(nl) % 7: raise ValueError("netlist length is not a multiple of 7 (LATCH/REF records not supported)")
    a, b = [], []
    for i in range(0, len(nl), 7):
        if nl[i] != 0x00:
            raise ValueError({1: "LATCH not expected", 2: "REF not expected (flatten)"}.get(nl[i], "bad opcode"))
        x, y = int.from_bytes(nl[i + 1:i + 4], "big"), int.from_bytes(nl[i + 4:i + 7], "big")
        if n_in is not None:
            own = 2 + n_in + len(a)
            if x >= own or y >= own: raise ValueError(f"NAND: future signal at record {len(a)}")
        a.append(x); b.append(y)
    return a, b


def run(a, b, n_in, in_bits):
    """Every signal value: [0, 1, inputs..., gate outputs...]."""
    assert len(in_bits) == n_in
    s = [0, 1] + [int(v) for v in in_bits]
    for x, y in zip(a, b): s.append(1 - (s[x] & s[y]))
    return s


def outputs(s, n_out): return s[len(s) - n_out:]


def unpack(hexstr, n):
    raw = bytes.fromhex(hexstr.removeprefix("0x"))
    return [(raw[i >> 3] >> (i & 7)) & 1 for i in range(n)]


def pack(bits):
    out = bytearray((len(bits) + 7) // 8)
    for i, v in enumerate(bits):
        if v: out[i >> 3] |= 1 << (i & 7)
    return "0x" + out.hex()


def netlist_sha256(hexstr): return "0x" + hashlib.sha256(bytes.fromhex(hexstr.removeprefix("0x"))).hexdigest()
