import argparse, copy, json, random
import numpy as np, torch
from difflogic import LogicLayer, GroupSum   # vendored in model/difflogic/ (see model/vendor_difflogic.py)

def unpack(h, n=64):
    b = bytes.fromhex(h[2:])
    return [(b[i >> 3] >> (i & 7)) & 1 for i in range(n)]

def load(path):
    X, y = [], []
    with open(path) as f:
        for line in f:
            r = json.loads(line); X.append(unpack(r["bits"])); y.append(int(r["label"]))
    return torch.tensor(X, dtype=torch.float32), torch.tensor(y, dtype=torch.long)

def build(widths, group, tau):
    # difflogic asserts out_dim * 2 >= in_dim for every layer, so widths must shrink
    # by at most half per layer, and the last hidden width must be <= 4 * group.
    mods, d = [], 64
    for w in widths + [2 * group]:
        assert 2 * w >= d, f"layer {d} -> {w}: difflogic needs each layer >= half the previous one"
        mods.append(LogicLayer(d, w, device="cpu", implementation="python", connections="random", grad_factor=1.1)); d = w
    return torch.nn.Sequential(*mods, GroupSum(k=2, tau=tau))   # neurons [0,G) = class 0 (human), [G,2G) = class 1 (bot)

def accuracy(model, X, y):
    model.eval()                     # eval() = hard, discrete gates
    with torch.no_grad(): pred = model(X).argmax(-1)
    model.train()
    return (pred == y).float().mean().item()

def export_gates(model, group):
    layers = []
    for m in model:
        if isinstance(m, LogicLayer):
            a, b = m.indices
            layers.append({"in": m.in_dim, "out": m.out_dim, "a": a.tolist(), "b": b.tolist(),
                           "op": m.weights.argmax(-1).tolist()})
    return {"nIn": 64, "group": group, "tau": float(model[-1].tau), "layers": layers}

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--train", required=True); p.add_argument("--val", required=True)
    p.add_argument("--widths", default="256,128,64", help="hidden layer widths, comma-separated")
    p.add_argument("--group", type=int, default=16); p.add_argument("--tau", type=float, default=0)
    p.add_argument("--epochs", type=int, default=200); p.add_argument("--batch", type=int, default=256)
    p.add_argument("--lr", type=float, default=0.01); p.add_argument("--seed", type=int, default=0)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    torch.manual_seed(a.seed); np.random.seed(a.seed); random.seed(a.seed)
    Xtr, ytr = load(a.train); Xva, yva = load(a.val)
    model = build([int(w) for w in a.widths.split(",")], a.group, a.tau or a.group / 4)
    counts = torch.bincount(ytr, minlength=2).float()
    loss_fn = torch.nn.CrossEntropyLoss(weight=counts.sum() / (2 * counts.clamp(min=1)))   # balances bots vs humans
    opt = torch.optim.Adam(model.parameters(), lr=a.lr)
    best, best_model = -1.0, None
    for ep in range(a.epochs):
        perm = torch.randperm(len(Xtr))
        for i in range(0, len(Xtr), a.batch):
            idx = perm[i:i + a.batch]
            loss = loss_fn(model(Xtr[idx]), ytr[idx]); opt.zero_grad(); loss.backward(); opt.step()
        acc = accuracy(model, Xva, yva)
        if acc > best: best, best_model = acc, copy.deepcopy(model)
        if ep % 10 == 0: print(f"epoch {ep}  discrete val acc {acc:.4f}  best {best:.4f}")
    torch.save(best_model, a.out)   # whole module: keeps connection indices
    json.dump(export_gates(best_model, a.group), open(a.out.replace(".pt", ".gates.json"), "w"))
    print("best discrete val acc", best)
