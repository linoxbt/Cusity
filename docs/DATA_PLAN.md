# Training data: Plan A feasibility (measured Nov 18, 2026)

The spec's biggest risk is labels. I tested **Plan A** (published sybil lists from past airdrops) by
checking how many listed wallets have ever sent a transaction on X Layer. Each check is one read-only
`eth_getTransactionCount` call against `rpc.xlayer.tech`, on a deterministic sample.

| Source | Licence | Size | Sample | Active on X Layer | Projected X Layer wallets |
|---|---|---|---|---|---|
| Hop airdrop: `eliminatedSybilAttackers.csv` (sybil, label 1) | ISC (package.json) | 14,195 | 600 | 0.8% | ~120 |
| Hop airdrop: `finalDistribution.csv`, bridge users with `hopUserTokens > 0` (label 0) | ISC | 28,857 | 600 | 3.8% | ~1,100 |
| LayerZero `initialList.txt` (sybil, label 1; includes ~300k self-reports) | **none stated** | 803,093 | 1,500 | 0.73% | **~5,900** |

Sources: github.com/hop-protocol/hop-airdrop (`src/data/`), and the LayerZero sybil report list
(the original `LayerZero-Labs/sybil-report` returns 404 now; the file is mirrored in public forks,
for example `DanielOneSinger/sybil-report`).

## What this means

- **Enough bots, few humans.** Combined, there are about 6,000 labelled sybil wallets on X Layer but only about 1,100 labelled non-sybils. The human side is the bottleneck. More negatives could come from Hop's full eligible list (including LP-only wallets), or from hand-checked active X Layer users.
- **Labels are borrowed.** They describe behaviour on other chains in 2022–2024. A wallet flagged by Hop or LayerZero isn't necessarily farming X Layer, and "not on a sybil list" doesn't mean human. The model card has to say this. On the plus side, the labels don't come from our own features, which avoids the leakage problem in review 2.3.
- **History is the real blocker.** The features need each wallet's full X Layer history. Scanning blocks over the public RPC runs at about 1,000 blocks a minute, and X Layer is at block ~76M, so indexing everything is out of reach. A per-address API turns this into one request per wallet: the **OKX X Layer Data API** (Onchain OS; OKLink's explorer API now lives here), `GET web3.okx.com/api/v5/xlayer/address/normal-transaction-list`, which returns gas price and limit too, covering about one year back from a wallet's latest transaction. Keys come from https://web3.okx.com/onchainos/dev-portal (project → Create API key, with a passphrase). Requests are HMAC-signed with the secret key, so the key, secret and passphrase go in `.env` as `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`. The code is in `data/history_okx.ts`; check it with `scripts/okx_probe.ts`.
- **Licensing.** Hop's data is ISC. LayerZero published its list for public bounty hunting but states no licence. Using it is your call.

Reproduce: `npx tsx scripts/sybil_overlap.ts <address list> [sample size]`.

## Built (Nov 18): `data/labels_public.csv`

2,425 wallets active on X Layer: 1,337 bot (137 Hop sybils, 1,200 LayerZero) and 1,088 human (Hop
bridge users). 408 wallets on both a sybil list and the human list were dropped.

**Sanity check without history** (`scripts/label_sanity.ts`: nonce, OKB, USDT0 and code from plain RPC):

| Signal | Bots (p25/p50/p75) | Humans (p25/p50/p75) | Best single rule, balanced accuracy |
|---|---|---|---|
| Transactions sent (nonce) | 2 / 4 / 12 | 3 / 8 / 35 | bot if ≤ 6: 59.4% |
| OKB balance | 0 / 0.0003 / 0.0094 | 0.0001 / 0.0043 / 0.0412 | bot if ≤ 0.0009: 60.9% |
| USDT0 balance | mostly 0 | mostly 0 | 50.8% (no signal) |

All four together reach **62–64% balanced accuracy** (5-fold logistic regression and gradient
boosting). The labels carry real but weak signal on X Layer without history. This is the baseline
the full 64-bit model has to beat; the history features (funder clusters, timing, repeated amounts,
gas sameness) are the ones expected to carry most of the signal.

## v2 model (Nov 19)

Two inputs from past Sybil hunts, in bits freed from near-constant ones (the empty name flag, thinner gas and campaign-window bands):

- **funderBurst** (LayerZero/Chaos Labs): other wallets the same funder paid within 24 h of this one.
- **collectorShared** (Hop): other wallets that pay this wallet's main non-contract recipient.
- **fundedFromHub** replaces the always-zero exchange flag: first funder is exchange-scale (1,000+ value txs) or a contract.
  Hubs link nobody, as Arbitrum removed exchanges, bridges and contracts before clustering.

Both counts come from the funder's and collector's own histories (OKX Data API, 20 pages), so they don't depend on who else is
in the input list. Distributions: funderBurst > 3 in 8% of bots vs 3% of humans; collectorShared > 3 in 6% vs 1%.

| Same 364 held-out wallets | v1 (807 gates) | **v2 (646 gates)** |
|---|---|---|
| Balanced accuracy | 65.6% | **67.8%** |
| Bot recall | 67.4% | **77.2%** |
| Bot precision | 67.7% | 67.7% |
| 5 seeds, (128, 64) widths | 65.9% ± 2.2 | **67.1% ± 1.1** |
| 5 seeds, (256, 256, 128, 64) | 65.8% ± 0.8 | 65.8% ± 1.2 |

Honest read: a modest gain. The new inputs fire on only 5–13% of wallets because X Layer histories are thin; where they fire they
are strong. v2 is also 20% smaller, so tape-out and audit gas are cheaper.

Test-set root `0x60bbb5fea6fcc1591ea7a7e3e6d177ecbb1bb76cf2c9dc218913a91b625ec07a` (same wallets as v1, new bits).
Netlist sha256 `0x9268d5e500e13f2c51dee1b61ca1365e45a5534684aad5cf91a0eef703ae78f5`, extractor `0x4ad8aeeb368be4d32e123884f8e4130eedb32a7fbc80972ddae94fa25cc752b6`.

## v1 model (Nov 18)

Snapshot block 76,254,000; histories from the OKX X Layer Data API; split 1,697 / 364 / 364.
Test-set root `0x4d69aaf631f3ce95e1b5eae00efa7478d859f4887b17c30c0ac7632d167a2218` (commit it on chain before the campaign).

| Model | Balanced accuracy |
|---|---|
| RPC-only signals (4 features, gradient boosting, 5-fold) | 62–64% |
| 64 bits, logistic regression / gradient boosting (5-fold) | 65.1% / 67.4% |
| **Cusity v1 circuit, 807 NAND gates, held-out test** | **65.6%** (precision 67.7%, recall 67.4%) |
| Ceiling: majority label per identical 64-bit vector | 83.3% accuracy (only 945 distinct vectors) |

Sweep (validation accuracy / gates): 192 → 68.4%, 303 → 65.7%, 471 → 67.9%, 633 → 68.7%, 906 → 67.9%, **807 → 72.3%**, 935 → 72.5%.
The 807-gate model was chosen on validation only: within noise of the best and 14% cheaper to tape out.
Bits 0 (age > 1 day), 61 (hasName) and 62 (fundedFromExchange) are constant in this data; filling the exchange list is the cheapest next gain.
