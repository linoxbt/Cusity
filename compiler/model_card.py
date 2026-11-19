"""Write build/model_card.json (linked from the registry by cardURI). Fill processor/circuitId after tape-out.
  python compiler/model_card.py --netlist build/cusity.netlist.json --sweep build/sweep.json --test-leaves data/test_leaves.json --version 3
"""
import argparse, json, subprocess
p = argparse.ArgumentParser()
p.add_argument("--netlist", required=True); p.add_argument("--sweep", required=True); p.add_argument("--test-leaves", required=True)
p.add_argument("--processor", default=""); p.add_argument("--circuit-id", type=int, default=0)
p.add_argument("--version", type=int, required=True); p.add_argument("--out", default="build/model_card.json")
a = p.parse_args()
nl, sw, tl = json.load(open(a.netlist)), json.load(open(a.sweep)), json.load(open(a.test_leaves))
ext = subprocess.run(["npx", "tsx", "data/extractor_hash.ts"], capture_output=True, text=True, check=True).stdout.strip()
git = lambda *args: subprocess.run(["git", *args], capture_output=True, text=True).stdout.strip()
test_commit = git("log", "-1", "--format=%H", "--", a.test_leaves)
card = {
    "name": f"Cusity bot filter v{a.version}", "version": a.version, "processor": a.processor, "circuitId": a.circuit_id,
    "netlistSha256": nl["netlistSha256"], "nIn": 64, "nOut": 7, "gates": nl["gates"],
    "outputs": {"verdict": 0, "marginBits": [1, 6], "marginOffset": 32},
    "architecture": {"widths": sw["chosen"]["widths"], "group": sw["chosen"]["group"], "library": "difflogic 0.1.0"},
    "features": "data/features.ts", "extractorSha256": ext, "testRoot": tl["root"], "testSize": tl["size"], "testDepth": tl["depth"],
    "testCommittedInGit": test_commit, "selection": sw["selection"], "test": sw["test"],
    "trainedOn": "Hop airdrop Sybil list (ISC) and LayerZero initial Sybil list as bots, Hop bridge users as humans; "
                 "wallets active on X Layer, snapshot block 76,254,000",
    "limits": "Only as honest as its inputs. Labels describe behaviour on other chains in 2022-2024, and the sources differ in "
              "era (every human is a 2022 Hop user; most bots are 2023-24 LayerZero), so some signal may be cohort, not behaviour: "
              "see test.by_source. Feature design and thresholds were chosen with the whole (unlabelled) feature distribution in "
              "view. Precision depends on how many bots a campaign really has: see test.bot_precision_at_prevalence. A filter "
              "result, not an accusation, and not a ban list. TapeOut's X Layer contracts are test-phase and unaudited.",
}
json.dump(card, open(a.out, "w"), indent=1); print(json.dumps(card, indent=1))
