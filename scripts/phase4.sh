#!/usr/bin/env bash
# Phase 3-4 in one go once the OKX Data API keys are set (OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE):
# labels -> 64-bit vectors -> 70/15/15 split -> test Merkle root -> sweep under 3,000 NAND -> parity -> card.
#   scripts/phase4.sh <snapshotBlock>
set -euo pipefail
cd "$(dirname "$0")/.."
BLOCK=${1:?usage: scripts/phase4.sh <snapshotBlock>}
ENVF=$([ -f .env ] && echo "--env-file=.env" || true)
npx tsx $ENVF data/extract.ts --history okx --wallets data/labels_public.csv --block "$BLOCK" --out data/vectors.jsonl
python model/split.py data/vectors.jsonl
npx tsx data/merkle.ts test data/test.jsonl            # commit its root on chain BEFORE training ends (docs/ONCHAIN.md)
python model/sweep.py --train data/train.jsonl --val data/val.jsonl --test data/test.jsonl --budget 3000
python compiler/parity.py --ckpt model/v1.pt --netlist build/cusity.netlist.json --data data/test.jsonl
python compiler/model_card.py --netlist build/cusity.netlist.json --sweep build/sweep.json --test-leaves data/test_leaves.json
echo "next: ./tapesynth synth build/cusity.v --top cusity --objective area --out build/cusity.tsyn.json, then parity on the .tsyn.json"
