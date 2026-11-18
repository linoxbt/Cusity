"""Write build/fixture.json: one known 64-bit vector and the netlist's verdict/margin for it.
Every test layer (Python, Solidity, web) checks this same vector, so a disagreement shows which layer broke."""
import json, sys
from tap02 import load_netlist_hex, parse, run, outputs, unpack
netlist_path, data_path, out_path = sys.argv[1:4]
rows = [json.loads(l) for l in open(data_path)]
a, b = parse(load_netlist_hex(netlist_path), 64)
fx = []
for r in rows[:2] + [next(r for r in rows if r["label"] != rows[0]["label"])]:
    o = outputs(run(a, b, 64, unpack(r["bits"], 64)), 7)
    fx.append({"bits": r["bits"], "verdict": o[0], "margin": sum(o[1 + k] << k for k in range(6)), "label": r["label"]})
json.dump({"netlist": netlist_path, "vectors": fx}, open(out_path, "w"), indent=1)
print(json.dumps(fx))
