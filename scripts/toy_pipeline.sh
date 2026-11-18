#!/usr/bin/env bash
# Phase 2 locally: toy data -> train -> Verilog -> NAND netlist -> parity -> fixture.
# Uses local Yosys synthesis; swap in `./tapesynth synth` for the real tape-out artifact.
set -euo pipefail
cd "$(dirname "$0")/.."
python model/toy_data.py
python model/train.py --train data/toy_train.jsonl --val data/toy_val.jsonl --widths 64,32 --group 8 --epochs 100 --out model/toy.pt
python compiler/export_verilog.py --gates model/toy.gates.json --out build/toy.v
python compiler/local_synth.py build/toy.v --out build/toy.netlist.json
python compiler/parity.py --ckpt model/toy.pt --netlist build/toy.netlist.json --data data/toy_test.jsonl
python compiler/make_fixture.py build/toy.netlist.json data/toy_test.jsonl build/fixture.json
