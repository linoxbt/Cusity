#!/usr/bin/env bash
# Every off-chain check in one go. Spends nothing.
#   python with requirements.txt installed (and model/difflogic vendored), node 22, forge on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== 1. export + synthesis parity (PyTorch vs TAP-02 netlist, full toy test set)"
python compiler/parity.py --ckpt model/toy.pt --netlist build/toy.netlist.json --data data/toy_test.jsonl
echo "== 2. data layer (packing, layout, funder clusters, Merkle)"
npx tsx --test data/data.test.ts 2>&1 | grep -E "^# (pass|fail)"
echo "== 3. contracts (unit, fuzz, real netlist, TS<->Solidity Merkle)"
(cd contracts && forge test 2>&1 | tail -1)
echo "== 4. web type-check and build"
npm run -w web build 2>&1 | grep -E "built in|error" || true
echo "all checks done"
