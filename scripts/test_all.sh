#!/usr/bin/env bash
# Every offline check, from a fresh clone (no checkpoints, keys or network needed except the npm/forge installs):
#   npm ci && pip install -r requirements.txt && scripts/setup_contracts.sh && scripts/test_all.sh
# The mainnet-fork suite is separate: (cd contracts && FORK=1 forge test --match-contract ForkTest -vv)
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(python3 -c "import json;print(json.load(open('build/model_card.json'))['version'])")
echo "== 1. gate list vs NAND netlist (toy, and model v$V on every wallet + 20,000 random inputs)"
python3 compiler/parity_gates.py --gates model/toy.gates.json --netlist build/toy.netlist.json --data data/toy_test.jsonl --random 2000
python3 compiler/parity_gates.py --gates "model/v$V.gates.json" --netlist build/cusity.netlist.json --data data/vectors.jsonl --random 20000
echo "== 2. data layer (packing, layout, extractor rules, positional Merkle)"
npx tsx --test data/*.test.ts 2>&1 | grep -E "^# (pass|fail)"
echo "== 3. every published artifact describes the same model and snapshot"
npx tsx scripts/merkle_compat.ts >/dev/null && git diff --quiet -- build/merkle_compat.json || { echo "merkle_compat.json changed: TS tree builder drifted"; exit 1; }
STRICT_MEASURED=1 npx tsx scripts/check_consistency.ts
echo "== 4. contracts (unit, fuzz, TS<->Solidity trees)"
(cd contracts && forge test 2>&1 | tail -1)
echo "== 5. web type-check and build"
npm run -w web build 2>&1 | tail -1
echo "all checks done"
