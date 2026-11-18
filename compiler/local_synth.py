"""Local Verilog -> TAP-02 NAND netlist, using Yosys + ABC (yowasp-yosys).

This is for testing and dry runs: TapeSynth does the real synthesis and tape-out. It lets the whole
pipeline (parity, contracts, web Explain view) run before TapeSynth is set up.

Output JSON: {"netlist": "0x..", "nIn": 64, "nOut": 7, "gates": N, "outputs": ["verdict", "margin[0]", ...]}
The last nOut records are the outputs, in port order (verdict first, then margin LSB-first), each driven
by a two-NAND buffer so they are always distinct elements (TAP-02 forbids outputs from inputs/constants).
"""
import argparse, json, subprocess, tempfile, os
from tap02 import netlist_sha256


def synth(verilog, top="cusity"):
    # yowasp-yosys runs as WebAssembly and can only see the working directory, so keep paths relative
    os.makedirs("build/tmp", exist_ok=True)
    with tempfile.TemporaryDirectory(dir="build/tmp") as d:
        j = os.path.relpath(os.path.join(d, "out.json"))
        verilog = os.path.relpath(verilog)
        subprocess.run(["yowasp-yosys", "-q", "-p",
                        f"read_verilog {verilog}; synth -flatten -top {top}; abc -g NAND; opt_clean; write_json {j}"],
                       check=True)
        return json.load(open(j))["modules"][top]


def to_tap02(mod):
    ports = mod["ports"]
    ins = [p for p, v in ports.items() if v["direction"] == "input"]
    outs = [p for p, v in ports.items() if v["direction"] == "output"]
    sig = {"0": 0, "1": 1, "x": 0}
    n_in = 0
    for p in ins:
        for bit in ports[p]["bits"]:
            sig[bit] = 2 + n_in; n_in += 1
    recs = []
    def emit(a, b): recs.append((a, b)); return 2 + n_in + len(recs) - 1
    cells = list(mod["cells"].values())
    pending = cells
    while pending:   # topological order
        nxt = []
        for c in pending:
            con = c["connections"]
            if c["type"] == "$_NAND_": a, b = con["A"][0], con["B"][0]
            elif c["type"] == "$_NOT_": a = b = con["A"][0]
            else: raise ValueError(f"unexpected cell {c['type']}")
            if a in sig and b in sig: sig[con["Y"][0]] = emit(sig[a], sig[b])
            else: nxt.append(c)
        if len(nxt) == len(pending): raise ValueError("combinational loop or undriven net")
        pending = nxt
    out_bits, names = [], []
    for p in outs:
        bits = ports[p]["bits"]
        for k, bit in enumerate(bits):
            out_bits.append(sig[bit] if bit in sig else sig[str(bit)])
            names.append(p if len(bits) == 1 else f"{p}[{k}]")
    inv = [emit(s, s) for s in out_bits]          # NOT
    for t in inv: emit(t, t)                       # NOT NOT = buffer; these are the last nOut records
    hexs = "0x" + b"".join(bytes([0]) + a.to_bytes(3, "big") + b.to_bytes(3, "big") for a, b in recs).hex()
    return {"netlist": hexs, "nIn": n_in, "nOut": len(out_bits), "gates": len(recs), "outputs": names,
            "netlistSha256": netlist_sha256(hexs)}


if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("verilog"); p.add_argument("--top", default="cusity"); p.add_argument("--out", required=True)
    a = p.parse_args()
    r = to_tap02(synth(a.verilog, a.top))
    json.dump(r, open(a.out, "w"), indent=1)
    print(f"{r['gates']} NAND records, nIn={r['nIn']}, nOut={r['nOut']}, outputs={r['outputs']}, sha256={r['netlistSha256']}")
