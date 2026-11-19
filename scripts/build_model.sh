#!/usr/bin/env bash
# The whole model build, in two phases with a commit in between, so the test set is provably fixed first:
#   scripts/build_model.sh data <snapshotBlock>     # extract -> split -> test-set root (then: git commit data/)
#   scripts/build_model.sh train <version>          # refuses unless the test set is committed and unchanged
# Needs OKX_* keys in .env for histories that are not cached yet (data/raw/okx/<block>/).
set -euo pipefail
cd "$(dirname "$0")/.."
ENVF=$([ -f .env ] && echo "--env-file=.env" || true)
case "${1:-}" in
  data)
    BLOCK=${2:?usage: build_model.sh data <snapshotBlock>}
    npx tsx $ENVF data/extract.ts --wallets data/labels_public.csv --block "$BLOCK" --out data/vectors.jsonl --raw build/raw_features.jsonl
    python3 data/clusters.py "$BLOCK" --groups
    python3 model/split.py data/vectors.jsonl build/groups.json
    npx tsx data/merkle.ts test data/test.jsonl
    echo "next: git add data/ build/groups.json build/raw_features.jsonl && git commit; STEP=test (commitTestSet on chain) if deploying; then scripts/build_model.sh train <version>" ;;
  train)
    V=${2:?usage: build_model.sh train <version>}
    for f in data/test.jsonl data/test_leaves.json data/train.jsonl data/val.jsonl; do
      git ls-files --error-unmatch "$f" >/dev/null 2>&1 && git diff --quiet HEAD -- "$f" \
        || { echo "refusing to train: $f is not committed as-is (commit the test set before training)"; exit 1; }
    done
    python3 model/sweep.py --train data/train.jsonl --val data/val.jsonl --test data/test.jsonl --version "$V"
    python3 compiler/parity.py --ckpt "model/v$V.pt" --netlist build/cusity.netlist.json --data data/vectors.jsonl
    python3 compiler/parity_gates.py --gates "model/v$V.gates.json" --netlist build/cusity.netlist.json --data data/vectors.jsonl --random 20000
    python3 compiler/model_card.py --netlist build/cusity.netlist.json --sweep build/sweep.json --test-leaves data/test_leaves.json --version "$V"
    npx tsx data/merkle.ts snapshot data/vectors.jsonl 0
    npx tsx scripts/shard_snapshot.ts build/snapshot_vectors.json web/public/snapshot
    python3 data/clusters.py "$(python3 -c "import json;print(json.loads(open('data/vectors.jsonl').readline())['block'])")"
    python3 scripts/web_artifacts.py --gates "model/v$V.gates.json"
    npx tsx scripts/check_consistency.ts ;;
  *) echo "usage: build_model.sh data <snapshotBlock> | train <version>"; exit 1 ;;
esac
