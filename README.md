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
| Model **v4**: 1194 NAND gates | ✅ held-out test (364 wallets, pushed to GitHub before training, scored once): **70.2% balanced accuracy** (95% CI 65.5–74.9), but **28.8% of humans are flagged**, and bot precision is 76% here, only 21% if 10% of a campaign are bots. A flag is a reason to look closer, not a verdict. The test wallets come from the same labelled pool earlier versions were developed on (no fresh labels exist), so treat these numbers as optimistic |
| Circuit = model | ✅ 0 mismatches on all 2,425 wallets + 20,000 random inputs (`compiler/parity_gates.py`) |
| Bits recomputable | ✅ every published row recomputes offline from the published inputs (`scripts/verify_snapshot.sh`, no API keys) |
| Extractor | ✅ deterministic from the history cache; backend, sources, config and viem version in `extractorHash` |
| Contracts | ✅ 45 unit tests (43 of 43 code mutations caught), mainnet-fork suite, full runbook rehearsed on a fork |
| Site | ✅ https://cusity.vercel.app · https://cusity.netlify.app, demo mode until the contracts are deployed |
| Tape-out, deploy, campaign on mainnet | ⏳ needs your keystore, ≈0.02 OKB and 0.01 BEM, and a keeper wallet: [`docs/ONCHAIN.md`](docs/ONCHAIN.md) |
| Labels | 2,425 X Layer wallets: 1,337 bots (137 Hop sybils, 1,200 LayerZero sybils), 1,088 Hop bridge users |

Earlier versions (v1–v3) are in `build/v1/` and the git history; their test sets differ, so their numbers are
not comparable. v4 fixed stale state reads that had kept an extractor fix out of v3's training bits.

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

See [What the contracts prove, and what they don't](docs/ONCHAIN.md#what-the-contracts-prove-and-what-they-dont).

- **Genuine circuit only.** The registry accepts only processors from TapeOut's factory with a pinned code hash, then hashes the processor's own netlist. Each circuit can be registered once.
- **Fixed in advance.** A campaign commits its netlist, extractor and test set at least a day before its snapshot. It publishes its wallets' bits within 7 days and binds within 14.
- **Inputs you can recompute.** Every wallet's bits sit in a positional Merkle tree; a wallet listed twice voids the campaign. Every input the extractor read is published, so anyone can recompute every row offline.
- **Accuracy scored on chain.** A block hash picks the rows; anyone can seal and finalize, and the keeper does both automatically. Unsealed rounds count as 0.
- **Still trusted.** The test labels: the project, not the model's author, should commit the test set. Also X Layer's sequencer and TapeOut's factory owner.

A result is a **filter result**, not an accusation. The circuit is only as honest as its inputs.

## Docs

- [Build spec](docs/BUILD_SPEC.md) · [Spec review](docs/SPEC_REVIEW.md) · [On-chain runbook](docs/ONCHAIN.md)
- [Hackathon submission answers](docs/SUBMISSION.md) · [Data plan and results](docs/DATA_PLAN.md) · [Brand kit](brand/README.md) · [Third-party notices](NOTICE.md)
