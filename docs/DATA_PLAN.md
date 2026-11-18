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
