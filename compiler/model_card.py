"""Write build/model_card.json (linked from the registry by cardURI). Fill processor/circuitId after tape-out.
  python compiler/model_card.py --netlist build/cusity.netlist.json --sweep build/sweep.json --test-leaves data/test_leaves.json
"""
import argparse, json, subprocess
p = argparse.ArgumentParser()
p.add_argument("--netlist", required=True); p.add_argument("--sweep", required=True); p.add_argument("--test-leaves", required=True)
p.add_argument("--processor", default=""); p.add_argument("--circuit-id", type=int, default=0)
p.add_argument("--out", default="build/model_card.json"); p.add_argument("--version", type=int, default=2)
p.add_argument("--baseline", default="", help="previous model_card.json, kept as a short comparison")
a = p.parse_args()
nl, sw, tl = json.load(open(a.netlist)), json.load(open(a.sweep)), json.load(open(a.test_leaves))
ext = subprocess.run(["npx", "tsx", "data/extractor_hash.ts"], capture_output=True, text=True, check=True).stdout.strip()
card = {
    "name": f"Cusity bot filter v{a.version}", "version": a.version, "processor": a.processor, "circuitId": a.circuit_id,
    "netlistSha256": nl["netlistSha256"], "nIn": 64, "nOut": 7, "gates": nl["gates"],
    "outputs": {"verdict": 0, "marginBits": [1, 6], "marginOffset": 32},
    "architecture": {"widths": sw["chosen"]["widths"], "group": sw["chosen"]["group"], "library": "difflogic 0.1.0"},
    "features": "data/features.ts", "extractorSha256": ext, "testRoot": tl["root"], "testSize": tl["size"],
    "test": sw["test"],
    "trainedOn": "Plan A labels: Hop airdrop sybils and bridge users (ISC), LayerZero initial sybil list; wallets active on X Layer",
    "changes": "v2 adds two Sybil-hunt features (LayerZero 24 h funding bursts, Hop shared collection addresses) and an exchange-scale funder flag; exchanges and contracts link nobody." if a.version >= 2 else "",
    "limits": "Only as honest as its inputs. Labels describe behaviour on other chains in 2022-2024. "
              "A filter result, not an accusation, and not a ban list. TapeOut's X Layer contracts are test-phase and unaudited.",
}
if a.baseline:
    b = json.load(open(a.baseline))
    card["previous"] = {"name": b["name"], "gates": b["gates"], "netlistSha256": b["netlistSha256"], "test": b["test"]}
json.dump(card, open(a.out, "w"), indent=1); print(json.dumps(card, indent=1))
