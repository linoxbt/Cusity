"""Gate list (model/*.gates.json) -> Verilog module `cusity`, pruning neurons that never reach the output.

Output order matters: bit 0 = verdict, bits 1..6 = margin (LSB first). The contracts read it that way.
"""
import argparse, json

# difflogic's 16 ops, in the order of bin_op in difflogic/functional.py (checked against 0.1.0).
OPS = {0: "1'b0", 1: "{a} & {b}", 2: "{a} & ~{b}", 3: "{a}", 4: "~{a} & {b}", 5: "{b}", 6: "{a} ^ {b}",
       7: "{a} | {b}", 8: "~({a} | {b})", 9: "~({a} ^ {b})", 10: "~{b}", 11: "{a} | ~{b}", 12: "~{a}",
       13: "~{a} | {b}", 14: "~({a} & {b})", 15: "1'b1"}
READS_A = set(range(16)) - {0, 5, 10, 15}
READS_B = set(range(16)) - {0, 3, 12, 15}


def export(g, top="cusity"):
    L, G = g["layers"], g["group"]
    assert L[-1]["out"] == 2 * G and G <= 16, "margin is 6 bits; keep group <= 16"
    keep = [set() for _ in L]; keep[-1] = set(range(L[-1]["out"]))
    for li in range(len(L) - 1, 0, -1):   # walk back: keep only neurons that reach the output
        for j in keep[li]:
            op = L[li]["op"][j]
            if op in READS_A: keep[li - 1].add(L[li]["a"][j])
            if op in READS_B: keep[li - 1].add(L[li]["b"][j])
    src = lambda li, i: f"x[{i}]" if li == 0 else f"n{li - 1}_{i}"
    v = [f"module {top} (input [63:0] x, output verdict, output [5:0] margin);"]
    for li, layer in enumerate(L):
        for j in sorted(keep[li]):
            v.append(f"  wire n{li}_{j} = " + OPS[layer["op"][j]].format(a=src(li, layer["a"][j]), b=src(li, layer["b"][j])) + ";")
    last = len(L) - 1
    v += ["  wire [5:0] c0 = " + " + ".join(f"n{last}_{j}" for j in range(G)) + ";      // class 0 = human",
          "  wire [5:0] c1 = " + " + ".join(f"n{last}_{j}" for j in range(G, 2 * G)) + ";  // class 1 = bot",
          "  assign verdict = c1 > c0;          // a tie goes to class 0, like argmax",
          "  assign margin  = 6'd32 + c1 - c0;",
          "endmodule"]
    return "\n".join(v) + "\n", sum(len(k) for k in keep), sum(l["out"] for l in L)


if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("--gates", required=True); p.add_argument("--out", required=True)
    a = p.parse_args()
    text, kept, total = export(json.load(open(a.gates)))
    open(a.out, "w").write(text)
    print(kept, "neurons kept of", total)
