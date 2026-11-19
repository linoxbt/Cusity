# Third-party material

Cusity's own code is MIT (see LICENSE). It includes or redistributes:

| What | Where | Licence / source |
|---|---|---|
| difflogic 0.1.0 (Felix Petersen), vendored, CPU-only patch | `model/difflogic/` | MIT, https://github.com/Felix-Petersen/difflogic |
| Space Grotesk | `web/src/fonts/SpaceGrotesk.woff2` | SIL OFL 1.1, © The Space Grotesk Project Authors (`web/src/fonts/OFL.txt`) |
| JetBrains Mono | `web/src/fonts/JetBrainsMono.woff2` | SIL OFL 1.1, © The JetBrains Mono Project Authors (`web/src/fonts/OFL.txt`) |
| OpenZeppelin Contracts 5.1.0, forge-std 1.17.0 | installed into `contracts/lib/` | MIT (forge-std: MIT or Apache-2.0) |
| viem, ox, abitype, @noble/curves, @noble/hashes, @scure/*, lenis (MIT); d3-force, d3-dispatch, d3-quadtree, d3-timer (ISC) | bundled into the site | full texts in `web/public/third-party-licenses.txt`, served at `/third-party-licenses.txt` (`npx tsx scripts/third_party_licenses.ts`) |
| Hop airdrop Sybil list and eligible users | labels in `data/labels_public.csv` | ISC, © Hop Protocol, https://github.com/hop-protocol/hop-airdrop |
| LayerZero initial Sybil list | labels in `data/labels_public.csv` | published by LayerZero Labs, https://github.com/LayerZero-Labs/sybil-report (no licence stated; used for research, with attribution) |
| Wallet histories | `build/raw_features.jsonl` (derived) | public X Layer chain data, read through the OKX X Layer Data API |

The ISC licence of the Hop data requires this notice: Copyright (c) Hop Protocol. Permission to use, copy, modify,
and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.
