"""Split data/vectors.jsonl 70/15/15 into data/{train,val,test}.jsonl (fixed seed)."""
import json, random, sys
rows = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else "data/vectors.jsonl")]
random.Random(0).shuffle(rows); n = len(rows)
for name, part in (("train", rows[:int(.7 * n)]), ("val", rows[int(.7 * n):int(.85 * n)]), ("test", rows[int(.85 * n):])):
    with open(f"data/{name}.jsonl", "w") as f: f.writelines(json.dumps(r) + "\n" for r in part)
    print(name, len(part))
