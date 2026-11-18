"""Everything the site ships about the current model, regenerated from build/ and data/:
web/public/model/{cusity.netlist.json, cusity.v, model_card.json, gates.json, feature_stats.json},
web/public/test_leaves.json and web/src/sample.json (24 held-out wallets for the landing ticker).

  python scripts/web_artifacts.py --gates model/v2.gates.json [--vectors data/vectors.jsonl]
"""
import argparse, json, os, re, shutil, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "compiler"))
import tap02

READS_A = {1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14}
READS_B = {1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14}

def slots():
    """Bit ranges per feature, parsed from data/features.ts (the single source of truth)."""
    src = open("data/features.ts").read()
    feats = re.findall(r'\{ name: "(\w+)",.*?thresholds: \[([^\]]*)\]', src[src.index("FEATURES"):src.index("export const FLAGS")])
    flags = re.findall(r'\{ name: "(\w+)"', src[src.index("export const FLAGS"):src.index("] as const")])
    out, k = [], 0
    for n, t in feats: c = len(t.split(",")); out.append((n, k, c, False)); k += c
    for n in flags: out.append((n, k, 1, True)); k += 1
    assert k == 64, k
    return out

def live(layers):
    keep = [set() for _ in layers]; keep[-1] = set(range(layers[-1]["out"]))
    for li in range(len(layers) - 1, 0, -1):
        for j in keep[li]:
            if layers[li]["op"][j] in READS_A: keep[li - 1].add(layers[li]["a"][j])
            if layers[li]["op"][j] in READS_B: keep[li - 1].add(layers[li]["b"][j])
    return keep

if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("--gates", required=True); p.add_argument("--vectors", default="data/vectors.jsonl")
    p.add_argument("--labels", default="data/labels_public.csv"); p.add_argument("--stats-only", action="store_true")
    p.add_argument("--stats-out", default="web/public/model/feature_stats.json")
    a = p.parse_args()
    g = json.load(open(a.gates)); L = g["layers"]; first = L[0]; keep0 = live(L)[0]
    rows = [json.loads(l) for l in open(a.vectors)]
    labels = {l.split(",")[0]: int(l.split(",")[1]) for l in open(a.labels).read().strip().split("\n")[1:]}
    stats = {}
    for name, start, count, is_flag in slots():
        bits = set(range(start, start + count))
        readers = sum(1 for j in keep0 if (first["op"][j] in READS_A and first["a"][j] in bits) or (first["op"][j] in READS_B and first["b"][j] in bits))
        bot, hum = [0] * (count + 1), [0] * (count + 1)
        for r in rows:
            b = tap02.unpack(r["bits"], 64); lvl = sum(b[start:start + count])
            (bot if labels[r["address"]] else hum)[lvl] += 1
        stats[name] = {"readers": readers, "bot": bot, "human": hum}
    json.dump({"features": stats}, open(a.stats_out, "w"))
    print("feature stats ->", a.stats_out)
    if a.stats_only: sys.exit()
    for f in ("cusity.netlist.json", "cusity.v", "model_card.json"): shutil.copy(f"build/{f}", f"web/public/model/{f}")
    shutil.copy(a.gates, "web/public/model/gates.json")
    shutil.copy("data/test_leaves.json", "web/public/test_leaves.json")
    nl = json.load(open("build/cusity.netlist.json")); A, B = tap02.parse(nl["netlist"], 64)
    test = [json.loads(l) for l in open("data/test.jsonl")]
    scored = []
    for r in test:
        o = tap02.outputs(tap02.run(A, B, 64, tap02.unpack(r["bits"], 64)), 7)
        scored.append({"w": r["address"][:6] + "…" + r["address"][-4:], "bits": r["bits"], "v": o[0], "m": sum(o[1 + k] << k for k in range(6)) - 32})
    fl = [s for s in scored if s["v"]][:12]; ps = [s for s in scored if not s["v"]][:12]
    json.dump([x for pair in zip(fl, ps) for x in pair], open("web/src/sample.json", "w"))
    print("model, gates, test leaves, sample -> web/")
