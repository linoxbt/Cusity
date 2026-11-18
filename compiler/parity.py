"""Discretized PyTorch model vs TAP-02 netlist, bit for bit, on a whole data file.

  python compiler/parity.py --ckpt model/toy.pt --netlist build/toy.netlist.json --data data/toy_test.jsonl
--netlist accepts our local_synth output or TapeSynth's .tsyn.json (see tap02.load_netlist_hex).
"""
import argparse, os, sys, torch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "model"))
from tap02 import load_netlist_hex, parse, run, outputs
from train import load

p = argparse.ArgumentParser()
p.add_argument("--ckpt", required=True); p.add_argument("--netlist", "--tsyn", required=True); p.add_argument("--data", required=True)
p.add_argument("--verdict-bit", type=int, default=0); p.add_argument("--margin-lsb", type=int, default=1)
a = p.parse_args()

model = torch.load(a.ckpt, weights_only=False); model.eval()
X, _ = load(a.data)
with torch.no_grad(): out = model(X)
cnt = torch.round(out * model[-1].tau).long()
t_verdict = (cnt[:, 1] > cnt[:, 0]).long(); t_margin = 32 + cnt[:, 1] - cnt[:, 0]

na, nb = parse(load_netlist_hex(a.netlist), 64)
bad = 0
for i in range(len(X)):
    o = outputs(run(na, nb, 64, X[i].long().tolist()), 7)
    v = o[a.verdict_bit]; m = sum(o[a.margin_lsb + k] << k for k in range(6))
    if v != t_verdict[i].item() or m != t_margin[i].item(): bad += 1
print(f"{bad} mismatches out of {len(X)} ({len(na)} NAND gates)")
sys.exit(1 if bad else 0)
