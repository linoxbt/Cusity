"""Split data/vectors.jsonl 70/15/15 into data/{train,val,test}.jsonl, grouped by connected component of the
labelled-wallet graph (shared non-exchange funder, shared collector, direct transfers: build/groups.json from
`python data/clusters.py --groups`), so linked wallets from one farm never sit on both sides. Fixed seed.
The test split's Merkle root must be committed (git, then on chain) before training.

  python model/split.py data/vectors.jsonl build/groups.json [seed]
"""
import json, random, sys
vec_path = sys.argv[1] if len(sys.argv) > 1 else "data/vectors.jsonl"
groups_path = sys.argv[2] if len(sys.argv) > 2 else "build/groups.json"
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 7
rows = [json.loads(l) for l in open(vec_path)]
comp = json.load(open(groups_path))
groups = {}
for r in rows: groups.setdefault(f"g{comp[r['address']]}" if r["address"] in comp else f"w{r['address']}", []).append(r)
keys = list(groups); random.Random(seed).shuffle(keys)
n, out, filled = len(rows), {"train": [], "val": [], "test": []}, 0
for k in keys:   # fill test, then val, then train, group by group
    part = "test" if filled < .15 * n else "val" if filled < .30 * n else "train"
    out[part].extend(groups[k]); filled += len(groups[k])
for name, part in out.items():
    with open(f"data/{name}.jsonl", "w") as fh: fh.writelines(json.dumps(r) + "\n" for r in part)
    print(name, len(part), f"bots {sum(r['label'] for r in part)}")
print(f"groups: {len(groups)} (largest {max(map(len, groups.values()))}), seed {seed}")
