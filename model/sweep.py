"""Phase 4 sweep: train tapered stacks, synthesize each to NAND, keep the best validation accuracy
that fits the gate budget. Writes model/v1.pt, build/cusity.v, build/cusity.netlist.json, build/sweep.json.

  python model/sweep.py --train data/train.jsonl --val data/val.jsonl --test data/test.jsonl [--budget 3000]
"""
import argparse, json, os, sys, torch
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "..", "compiler"))
from train import fit, export_gates, load
from export_verilog import export
from local_synth import synth, to_tap02
from tap02 import parse, run, outputs

CONFIGS = [  # (hidden widths, group); each layer >= half the previous, last hidden <= 4 * group
    ((64, 32), 8), ((128, 64), 16), ((256, 128, 64), 16), ((256, 256, 128, 64), 16), ((512, 256, 128, 64), 16)]


def netlist_metrics(nl, path):
    a, b = parse(nl["netlist"], 64)
    X, y = load(path)
    pred = [outputs(run(a, b, 64, x.long().tolist()), 7)[0] for x in X]
    tp = sum(1 for p, t in zip(pred, y.tolist()) if p == 1 and t == 1); fp = sum(1 for p, t in zip(pred, y.tolist()) if p == 1 and t == 0)
    pos = int(y.sum()); neg = len(y) - pos
    tn = neg - fp
    return {"accuracy": sum(int(p == t) for p, t in zip(pred, y.tolist())) / len(y),
            "balanced_accuracy": (tp / max(pos, 1) + tn / max(neg, 1)) / 2,
            "bot_precision": tp / max(tp + fp, 1), "bot_recall": tp / max(pos, 1), "n": len(y)}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--train", required=True); p.add_argument("--val", required=True); p.add_argument("--test", required=True)
    p.add_argument("--budget", type=int, default=3000); p.add_argument("--epochs", type=int, default=200)
    p.add_argument("--configs", default="", help="override, e.g. '64,32:8;128,64:16'")
    p.add_argument("--out-prefix", default="cusity"); p.add_argument("--model-out", default="model/v1.pt")
    p.add_argument("--sweep-out", default="build/sweep.json")
    a = p.parse_args()
    configs = CONFIGS if not a.configs else [(tuple(int(w) for w in c.split(":")[0].split(",")), int(c.split(":")[1])) for c in a.configs.split(";")]
    os.makedirs("build", exist_ok=True)
    results, best = [], None
    for widths, group in configs:
        model, val_acc = fit(a.train, a.val, widths, group, epochs=a.epochs, log=None)
        g = export_gates(model, group)
        v_path = f"build/tmp/sweep_{'-'.join(map(str, widths))}_{group}.v"
        os.makedirs("build/tmp", exist_ok=True)
        open(v_path, "w").write(export(g)[0])
        nl = to_tap02(synth(v_path))
        r = {"widths": list(widths), "group": group, "val_accuracy": round(val_acc, 4), "nand_gates": nl["gates"],
             "fits_budget": nl["gates"] <= a.budget}
        results.append(r); print(json.dumps(r))
        if r["fits_budget"] and (best is None or val_acc > best[0]):
            best = (val_acc, r, model, g, v_path, nl)
    if best is None: sys.exit("no configuration fits the gate budget")
    _, r, model, g, v_path, nl = best
    torch.save(model, a.model_out); json.dump(g, open(a.model_out.replace(".pt", ".gates.json"), "w"))
    os.replace(v_path, f"build/{a.out_prefix}.v")
    json.dump(nl, open(f"build/{a.out_prefix}.netlist.json", "w"), indent=1)
    test = netlist_metrics(nl, a.test)
    json.dump({"budget": a.budget, "results": results, "chosen": r, "test": test}, open(a.sweep_out, "w"), indent=1)
    print("chosen", json.dumps(r), "test", json.dumps(test))
