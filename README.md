# Cusity

**The bot filter you can check.** Cusity is a bot filter for airdrops and campaigns on X Layer. The
model is a learned logic-gate network, compiled to NAND gates and taped out as a single TapeOut
circuit. It has no weights file and no server. Anyone can check an entrant for free, see which inputs
decided the result, audit the model's accuracy on chain, and appeal.

Built for **X Layer TapeOut Accelerate** (deadline Dec 7, 2026).

```
wallet ──extractor──▶ 64 bits ──▶ [ NAND circuit on X Layer ] ──▶ verdict + margin
                 (Merkle-committed)          ▲          │
                                   CampaignCommit   AccuracyAudit   ◀── web: Check · Explain · Audit · Appeal
```

## Status

| Stage | State |
|---|---|
| Toy model → Verilog → TAP-02 NAND netlist (251 gates) | ✅ trained, **0 mismatches** vs PyTorch |
| TAP-02 evaluator vs live X Layer `eval` | ✅ matches the chain (`scripts/phase0_check.sh`) |
| Extractor on live X Layer data | ✅ deterministic, byte-identical reruns |
| Contracts: Registry, CampaignCommit, AccuracyAudit | ✅ 20 Foundry tests incl. fuzz, real netlist, TS↔Solidity Merkle |
| Web: Check, Explain, Audit, Appeal | ✅ builds, runs in demo mode, desktop and mobile |
| Tape-out on a live processor | ✅ on an X Layer mainnet fork: netlist, hash and `eval` match; real cost 0.33 OKB for 251 gates |
| Site | ✅ live at https://cusity.vercel.app (demo mode until contracts are deployed) |
| Tape-out, deploy, campaign on mainnet | ⏳ needs your key and OKB: [`docs/ONCHAIN.md`](docs/ONCHAIN.md) |
| Plan A labels | ✅ 2,425 X Layer wallets (1,337 bot, 1,088 human), `data/labels_public.csv` |
| Real model v1 | ✅ 807 NAND gates, trained on real X Layer histories (OKX Data API, snapshot block 76,254,000). Held-out test: **65.6% balanced accuracy** (bot precision 67.7%, recall 67.4%). Parity 0 mismatches on 2,061 wallets. Tapes out on a live processor (fork) for 1.07 OKB |

## Layout

```
data/        features.ts (64-bit layout), indexer.ts, history.ts, extract.ts, extractor_hash.ts, merkle.ts
model/       train.py (tapered difflogic), toy_data.py, split.py, vendored difflogic/ (CPU)
compiler/    export_verilog.py, local_synth.py (Yosys → TAP-02), tap02.py, parity.py, make_fixture.py
contracts/   Foundry: CusityRegistry, CampaignCommit, AccuracyAudit, Deploy script, tests
web/         Vite + TypeScript + viem static site for DeWEB
build/       netlists, fixture, Merkle trees, demo snapshot
brand/       logo and social assets
docs/        build spec, review, on-chain runbook, submission answers
```

## Reproduce

```bash
# Python 3.10+, Node 22, Foundry
python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
npm install
(cd contracts && forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git)

scripts/toy_pipeline.sh     # toy data → train → Verilog → NAND netlist → parity → fixture
scripts/test_all.sh         # parity, data tests, contract tests, web build
npm run -w web dev          # site in demo mode at http://localhost:5173
```

`model/difflogic/` is difflogic 0.1.0 (MIT) with its CUDA import made optional, so training runs on
CPU. Recreate it with `python model/vendor_difflogic.py`.

## How the trust works

- **The model can't change after the snapshot.** `CampaignCommit.commit` stores the netlist's sha256 before the snapshot. `bind` only succeeds if the taped-out circuit, hashed on chain by the registry, matches.
- **Inputs can't change either.** Every entrant's 64 bits go into a Merkle root published after the snapshot. The page verifies the proof before it shows a result.
- **Accuracy is checked on chain.** A future block hash picks test rows, and the contract runs `eval` on each one. A model has at most one open round at a time, and abandoned rounds stay on record as expired.
- **The extractor is pinned.** `extractorHash` covers the extractor's source files and its config: thresholds, window, OKB price and exchange list.

A result is a **filter result**, not an accusation. The circuit is only as honest as its inputs.

## Docs

- [Build spec](docs/BUILD_SPEC.md) · [Spec review](docs/SPEC_REVIEW.md) · [On-chain runbook](docs/ONCHAIN.md)
- [Hackathon submission answers](docs/SUBMISSION.md) · [Brand kit](brand/README.md)
