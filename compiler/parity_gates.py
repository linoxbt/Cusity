"""Exported gate list (model/v<N>.gates.json, what the site's stage pages run) vs the TAP-02 NAND netlist,
bit for bit on verdict and margin. Needs no PyTorch checkpoint, so it runs from a fresh clone.

  python compiler/parity_gates.py --gates model/v3.gates.json --netlist build/cusity.netlist.json --data data/vectors.jsonl [--random 20000]
"""
import argparse, json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from tap02 import parse, run, outputs, unpack

OPS = [lambda a, b: 0, lambda a, b: a & b, lambda a, b: a & (1 - b), lambda a, b: a, lambda a, b: (1 - a) & b,
       lambda a, b: b, lambda a, b: a ^ b, lambda a, b: a | b, lambda a, b: 1 - (a | b), lambda a, b: 1 - (a ^ b),
       lambda a, b: 1 - b, lambda a, b: a | (1 - b), lambda a, b: 1 - a, lambda a, b: (1 - a) | b,
       lambda a, b: 1 - (a & b), lambda a, b: 1]

def gates_eval(g, bits):
    x = bits
    for l in g["layers"]: x = [OPS[o](x[a], x[b]) for a, b, o in zip(l["a"], l["b"], l["op"])]
    G = g["group"]; human, bot = sum(x[:G]), sum(x[G:2 * G])
    return int(bot > human), 32 + bot - human

if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("--gates", required=True); p.add_argument("--netlist", required=True)
    p.add_argument("--data", required=True); p.add_argument("--random", type=int, default=0)
    a = p.parse_args()
    g = json.load(open(a.gates)); A, B = parse(json.load(open(a.netlist))["netlist"], 64)
    inputs = [unpack(json.loads(l)["bits"], 64) for l in open(a.data)]
    rng = random.Random(0); inputs += [[rng.randrange(2) for _ in range(64)] for _ in range(a.random)]
    bad = 0
    for bits in inputs:
        o = outputs(run(A, B, 64, bits), 7)
        if (o[0], sum(o[1 + k] << k for k in range(6))) != gates_eval(g, bits): bad += 1
    print(f"{bad} mismatches out of {len(inputs)} ({len(A)} NAND gates)")
    sys.exit(1 if bad else 0)
