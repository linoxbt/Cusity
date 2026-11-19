"""Split data/vectors.jsonl 70/15/15 into data/{train,val,test}.jsonl, grouped so that wallets sharing a
first funder (one that is not exchange-scale) land in the same split: siblings from one farm can't sit on
both sides. Fixed seed. The test split's Merkle root must be committed (git, then on chain) before training.

  python model/split.py data/vectors.jsonl build/raw_features.jsonl [seed]
"""
import collections, json, random, sys
vec_path = sys.argv[1] if len(sys.argv) > 1 else "data/vectors.jsonl"
raw_path = sys.argv[2] if len(sys.argv) > 2 else "build/raw_features.jsonl"
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 3
rows = [json.loads(l) for l in open(vec_path)]
raw = {r["address"]: r for r in map(json.loads, open(raw_path))}
groups = collections.OrderedDict()
for r in rows:
    f = raw[r["address"]]
    key = f"funder:{f['funder']}" if f.get("funder") and not f.get("funderHub") else f"wallet:{r['address']}"
    groups.setdefault(key, []).append(r)
keys = list(groups); random.Random(seed).shuffle(keys)
n, out, filled = len(rows), {"train": [], "val": [], "test": []}, 0
for k in keys:   # fill test, then val, then train, group by group
    part = "test" if filled < .15 * n else "val" if filled < .30 * n else "train"
    out[part].extend(groups[k]); filled += len(groups[k])
for name, part in out.items():
    with open(f"data/{name}.jsonl", "w") as fh: fh.writelines(json.dumps(r) + "\n" for r in part)
    print(name, len(part), f"bots {sum(r['label'] for r in part)}")
print(f"groups: {len(groups)} (largest {max(map(len, groups.values()))}), seed {seed}")
