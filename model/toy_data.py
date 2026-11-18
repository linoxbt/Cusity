import json, numpy as np
from sklearn.datasets import load_breast_cancer

X, y = load_breast_cancer(return_X_y=True)
cols = [0, 1, 2, 3, 6, 7, 20, 27]   # 8 features x 8 thresholds = 64 bits
B = np.concatenate([(X[:, c][:, None] > np.quantile(X[:, c], np.linspace(0.1, 0.9, 8))[None, :]).astype(np.uint8)
                    for c in cols], axis=1)

def pack(row):
    out = bytearray(8)
    for i, b in enumerate(row):
        if b: out[i >> 3] |= 1 << (i & 7)
    return "0x" + out.hex()

idx = np.random.default_rng(0).permutation(len(B)); n = len(idx)
for name, part in (("train", idx[:int(.7 * n)]), ("val", idx[int(.7 * n):int(.85 * n)]), ("test", idx[int(.85 * n):])):
    with open(f"data/toy_{name}.jsonl", "w") as f:
        for i in part: f.write(json.dumps({"address": None, "bits": pack(B[i]), "label": int(y[i])}) + "\n")
