"""Train tapered difflogic stacks, synthesize each to NAND, keep the best BALANCED validation accuracy that
fits the gate budget (mean over seeds; ties go to fewer gates). The test set is scored once, at the end,
on the chosen netlist only.

  python model/sweep.py --train data/train.jsonl --val data/val.jsonl --test data/test.jsonl \
      --labels data/labels_public.csv --version 3 [--budget 3000] [--seeds 3]
Writes model/v<version>.pt + .gates.json, build/cusity.v, build/cusity.netlist.json, build/sweep.json.
"""
import argparse, json, os, random, sys, torch
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "..", "compiler"))
from train import fit, export_gates, load
from export_verilog import export
from local_synth import synth, to_tap02
from tap02 import parse, run, outputs, unpack

CONFIGS = [  # (hidden widths, group); each layer >= half the previous, last hidden <= 4 * group
    ((64, 32), 8), ((128, 64), 16), ((256, 128, 64), 16), ((256, 256, 128, 64), 16), ((512, 256, 128, 64), 16)]


def predict(nl, rows):
    a, b = parse(nl["netlist"], 64)
    return [outputs(run(a, b, 64, unpack(r["bits"], 64)), 7)[0] for r in rows]


def rates(pred, y):
    tp = sum(p and t for p, t in zip(pred, y)); fp = sum(p and not t for p, t in zip(pred, y))
    pos = sum(y); neg = len(y) - pos
    rec, spec = tp / max(pos, 1), (neg - fp) / max(neg, 1)
    return rec, spec


def metrics(nl, rows, train_rows, labels_csv):
    """Everything the audit asked for: balanced accuracy with a bootstrap CI, false-positive rate, precision at
    realistic bot prevalence, per-source rates, and accuracy on vectors never seen in training."""
    pred, y = predict(nl, rows), [r["label"] for r in rows]
    rec, spec = rates(pred, y)
    src = {l.split(",")[0]: l.split(",")[2] for l in open(labels_csv).read().strip().split("\n")[1:]}
    rng = random.Random(0); boots = []
    for _ in range(2000):
        idx = [rng.randrange(len(rows)) for _ in rows]
        r_, s_ = rates([pred[i] for i in idx], [y[i] for i in idx]); boots.append((r_ + s_) / 2)
    boots.sort()
    prec_at = lambda prev: rec * prev / max(rec * prev + (1 - spec) * (1 - prev), 1e-9)
    by_source = {}
    for s in sorted(set(src[r["address"]] for r in rows)):
        ix = [i for i, r in enumerate(rows) if src[r["address"]] == s]
        flagged = sum(pred[i] for i in ix) / len(ix)
        by_source[s] = {"n": len(ix), "flagged": round(flagged, 4)}
    seen = {r["bits"] for r in train_rows}
    unseen = [i for i, r in enumerate(rows) if r["bits"] not in seen]
    ru, su = rates([pred[i] for i in unseen], [y[i] for i in unseen])
    tp = sum(p and t for p, t in zip(pred, y)); fp = sum(p and not t for p, t in zip(pred, y))
    return {"n": len(rows), "accuracy": sum(p == t for p, t in zip(pred, y)) / len(y),
            "balanced_accuracy": (rec + spec) / 2, "balanced_accuracy_ci95": [boots[50], boots[1949]],
            "bot_recall": rec, "human_specificity": spec, "human_false_positive_rate": 1 - spec,
            "bot_precision": tp / max(tp + fp, 1), "bot_precision_at_prevalence": {"10%": prec_at(.1), "30%": prec_at(.3)},
            "flag_rate": sum(pred) / len(pred), "by_source": by_source,
            "unseen_vectors": {"n": len(unseen), "balanced_accuracy": (ru + su) / 2}}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--train", required=True); p.add_argument("--val", required=True); p.add_argument("--test", required=True)
    p.add_argument("--labels", default="data/labels_public.csv"); p.add_argument("--version", type=int, required=True)
    p.add_argument("--budget", type=int, default=3000); p.add_argument("--epochs", type=int, default=200); p.add_argument("--seeds", type=int, default=3)
    p.add_argument("--configs", default="", help="override, e.g. '64,32:8;128,64:16'")
    p.add_argument("--sweep-out", default="build/sweep.json")
    a = p.parse_args()
    configs = CONFIGS if not a.configs else [(tuple(int(w) for w in c.split(":")[0].split(",")), int(c.split(":")[1])) for c in a.configs.split(";")]
    os.makedirs("build/tmp", exist_ok=True)
    results, best = [], None
    for widths, group in configs:
        runs = []
        for seed in range(a.seeds):
            model, val_bal = fit(a.train, a.val, widths, group, epochs=a.epochs, seed=seed, log=None)
            g = export_gates(model, group)
            v_path = f"build/tmp/sweep_{'-'.join(map(str, widths))}_{group}_s{seed}.v"
            open(v_path, "w").write(export(g)[0])
            runs.append((val_bal, seed, model, g, v_path, to_tap02(synth(v_path))))
        mean = sum(r[0] for r in runs) / len(runs)
        top = max(runs, key=lambda r: r[0])
        r = {"widths": list(widths), "group": group, "val_balanced_mean": round(mean, 4),
             "val_balanced_by_seed": [round(x[0], 4) for x in runs], "chosen_seed": top[1],
             "nand_gates": top[5]["gates"], "fits_budget": top[5]["gates"] <= a.budget}
        results.append(r); print(json.dumps(r), flush=True)
        if r["fits_budget"] and (best is None or (mean, -r["nand_gates"]) > (best[0], -best[1]["nand_gates"])):
            best = (mean, r, top)
    if best is None: sys.exit("no configuration fits the gate budget")
    _, r, (_, _, model, g, v_path, nl) = best
    out = f"model/v{a.version}.pt"
    torch.save(model, out); json.dump(g, open(out.replace(".pt", ".gates.json"), "w"))
    os.replace(v_path, "build/cusity.v")
    json.dump(nl, open("build/cusity.netlist.json", "w"), indent=1)
    rows = lambda f: [json.loads(l) for l in open(f)]
    test = metrics(nl, rows(a.test), rows(a.train), a.labels)   # the one and only look at the test set
    json.dump({"version": a.version, "budget": a.budget, "selection": "mean balanced validation accuracy over seeds; ties -> fewer gates",
               "results": results, "chosen": r, "test": test}, open(a.sweep_out, "w"), indent=1)
    print("chosen", json.dumps(r)); print("test", json.dumps(test, indent=1))
