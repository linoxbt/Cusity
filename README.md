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
| Model **v3**: 993 NAND gates | ✅ held-out test (365 wallets, frozen in git before training, scored once): **70.0% balanced accuracy** (95% CI 65.4–74.5), **22.2% of humans flagged**, bot precision 76.9% here (24% if only 10% of a campaign are bots). Hop sybils flagged 82% vs Hop users 22%. Selected on validation only |
| Circuit = model | ✅ 0 mismatches on all 2,425 wallets + 20,000 random inputs (`compiler/parity_gates.py`) |
| Extractor | ✅ deterministic from the history cache; backend, sources, config and viem version in `extractorHash` |
| Contracts | ✅ 37 unit tests (23 of 23 code mutations caught), mainnet-fork suite, full runbook rehearsed on a fork |
| Site | ✅ https://cusity.vercel.app · https://cusity.netlify.app, demo mode until the contracts are deployed |
| Tape-out, deploy, campaign on mainnet | ⏳ needs your keystore, ≈0.02 OKB and 0.01 BEM: [`docs/ONCHAIN.md`](docs/ONCHAIN.md) |
| Labels | 2,425 X Layer wallets: 1,337 bots (137 Hop sybils, 1,200 LayerZero sybils), 1,088 Hop bridge users |

Earlier versions (v1, v2) are in `build/v1/` and the git history; their test sets differ from v3's, so their
numbers are not comparable.

## Layout

```
data/        features.ts (64-bit layout), history*.ts, extract.ts, extractor_hash.ts, merkle*.ts (positional trees), clusters.py
model/       train.py (tapered difflogic), sweep.py, split.py (grouped by funder), vendored difflogic/ (CPU)
compiler/    export_verilog.py, local_synth.py (Yosys → TAP-02), tap02.py, parity.py, parity_gates.py, model_card.py
contracts/   Foundry: CusityRegistry, CampaignCommit, AccuracyAudit, PositionalMerkle; Deploy/TapeOut/Campaign scripts; tests
scripts/     build_model.sh (two-phase), campaign_snapshot.sh, test_all.sh, check_consistency.ts, setup_contracts.sh
web/         Vite + TypeScript + viem static site for DeWEB
build/       netlists, fixture, Merkle trees, demo snapshot
brand/       logo and social assets
docs/        build spec, review, on-chain runbook, submission answers
```

## Reproduce

```bash
# Python 3.13, Node 22, Foundry (versions pinned in requirements.txt, .nvmrc, scripts/setup_contracts.sh)
python -m venv .venv && source .venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0 && pip install -r requirements.txt
npm ci
scripts/setup_contracts.sh

scripts/test_all.sh                      # every offline check, from a fresh clone
(cd contracts && FORK=1 forge test -vv)  # mainnet-fork suite incl. the runbook rehearsal
npm run -w web dev                       # site in demo mode at http://localhost:5173

# rebuild the model (needs OKX_* keys in .env for uncached histories)
scripts/build_model.sh data 76254000     # extract → split → test root; then commit data/
scripts/build_model.sh train 3           # refuses to train on an uncommitted test set
```

`model/difflogic/` is difflogic 0.1.0 (MIT) with its CUDA import made optional, so training runs on
CPU. Recreate it with `python model/vendor_difflogic.py`.

## How the trust works

- **Only a genuine TapeOut circuit can be registered.** The registry checks the processor against TapeOut's factory and a pinned code hash (its evaluator cannot be upgraded), then hashes the processor's own netlist bytes.
- **The model can't change after the snapshot.** `CampaignCommit.commit` stores the netlist and extractor hashes before the snapshot; `bind` only succeeds if the registered model matches both.
- **Inputs are fixed within 7 days of the snapshot.** Every entrant's 64 bits go into a positional Merkle tree, sorted by wallet; a wallet listed twice can be proven on chain by anyone, which voids the campaign. The site rebuilds the whole tree from the published list.
- **Accuracy is scored on chain.** A future block hash picks test rows; anyone can seal and finalize. Each test row names its wallet, so its label can be checked against the public Sybil lists. Unsealed rounds count as 0.
- **What it can't prove:** the model owner chooses the test labels (they come from public lists, so they are checkable), and the sequencer could influence a block hash.

A result is a **filter result**, not an accusation. The circuit is only as honest as its inputs.

## Docs

- [Build spec](docs/BUILD_SPEC.md) · [Spec review](docs/SPEC_REVIEW.md) · [On-chain runbook](docs/ONCHAIN.md)
- [Hackathon submission answers](docs/SUBMISSION.md) · [Data plan and results](docs/DATA_PLAN.md) · [Brand kit](brand/README.md) · [Third-party notices](NOTICE.md)
