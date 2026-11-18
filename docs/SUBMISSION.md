# Cusity: TapeOut Accelerate registration form

Form: "OKX X Layer TapeOut Accelerate: Tapeout Registration" (https://forms.gle/EoDNbxQ65dev1wFd9).
It needs a Google sign-in. The form says you can register early and update your entry later, and that
judging uses the version in place at the deadline (Dec 7, 23:59 UTC).

| # | Field (required unless noted) | Answer |
|---|---|---|
| 1 | Full Name | *you* |
| 2 | Nationality (used to pick the offline finale venue) | *you* |
| 3 | Project name | Cusity |
| 4 | Project logo (256×256, ≤10 MB, file upload) | *upload a 256×256 PNG* |
| 5 | Telegram handle | *you* |
| 6 | Project X Account | *the project's X handle* |
| 7 | Team contact email | *you* |
| 8 | Team size (max 4) | *you* |
| 9 | Team background | *you* |
| 10 | Elevator pitch | see below |
| 11 | GitHub repo | https://github.com/linoxbt/cusity (make it public first) |
| 12 | Demo video (≤3 min; longer may be disqualified) | *until it exists, put "Coming before Dec 7" and update the entry later* |
| 13 | Project website (optional) | *DeWEB link once the site is live; leave blank for now* |

## Elevator pitch (field 10)

Cusity is a bot filter for airdrops and campaigns on X Layer that lets people check why a wallet was flagged, addressing the lack of transparency that causes public disputes each airdrop season. It compiles a trained logic gate network into a single TapeOut circuit, with no weights file or server. Unlike existing filters, its netlist hash is committed on chain before the campaign snapshot, wallet inputs are fixed by a Merkle root, and accuracy is scored on chain using randomly sampled rows from a test set committed in advance. Anyone can check a wallet for free via eth_call, inspect a gate-level explanation in their browser, and appeal through TapeSend. We’ll run our own giveaway first, then offer campaign-specific retraining to X Layer projects running quests and airdrops, which pay to commission and commit each filter.

## Not on this form, but required by the hackathon page

Circuit projects must provide the **processor contract address and circuit ID**, and sites must give
a link and name the TapeOut features they use. This form has no fields for them, so put them in the
repo README and the demo video, and ask in the Telegram group where they should go.

- Processor: [[0x…]] · Circuit ID: [[#]]
- CusityRegistry [[0x…]] · CampaignCommit [[0x…]] · AccuracyAudit [[0x…]]
- TapeOut features used: Processor, NAND transistors, tape-out, `eval`, `netlist`, `circuitInfo`, Circuit Container, DeWEB (Website Repository), TapeKit, TapeSend; built with TapeSynth
- Campaign proof: commit tx [[link]] before snapshot block [[#]], bind tx [[link]], audit score [[x/16]], [[N]] wallets checked, [[M]] appeals handled
