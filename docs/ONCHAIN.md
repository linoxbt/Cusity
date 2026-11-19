# On-chain runbook

Everything below has been rehearsed end to end on an X Layer mainnet fork, with the same scripts:
`cd contracts && FORK=1 forge test --match-contract RunbookTest -vv` (deploy → tape-out on #419 → test commit →
register → campaign commit → publish → bind → `verdictOf` on real snapshot wallets → K=16 audit on the real
held-out test set). Nothing in this file needs a private key in a file, an environment variable or on a command line.

## What you need

- **A Foundry keystore**, created once. The key is stored encrypted, and you type its password when a script signs:
  `cast wallet import cusity --interactive`
- **Gas money:** ≈ 0.02 OKB on X Layer, and 0.01 BEM if you use processor #419 or #422.
  - BEM is a LayerZero token; bridge it from BNB Chain.
  - Processor #180 needs no BEM but costs ≈ 0.66 OKB for 993 gates.
- **Tools:** `scripts/setup_contracts.sh`, once per clone (installs forge-std 1.17.0 and OpenZeppelin 5.1.0).
- **Rule:** never put the key in `.env`, never `set -a; source .env`, and run `npm ci --ignore-scripts` on any
  third-party tooling before secrets are anywhere near the shell.

## Measured on a mainnet fork (Nov 19, 2026, model v4, 1,194 NAND gates)

| | |
|---|---|
| Tape-out on #419 / #422 | 0.0013 OKB + 0.01 BEM (mint price 0) |
| Tape-out on #180 (`BEM_FEE=false`) | 0.789 OKB (0.00066 OKB per gate + 0.0013) |
| Tape-out on #300 (`BEM_FEE=false`) | 1.577 OKB |
| `verdictOf` (free, `eth_call`) | 2.74M gas |
| `finalizeAudit`, one 4-row batch | 11.0M gas (below a 16.8M per-transaction cap; K = 16 takes 4 batches) |
| Own processor (`createCPU`) | refused by the factory today (`test_ownProcessorRouteIsClosed` flags when that changes) |

Only genuine TapeOut processors are accepted by `CusityRegistry`. A processor must pass two checks:
- **Factory check:** `isCPU` on the factory returns true for it.
- **Code check:** its runtime code hash is one of the two pinned proxy builds.

Both builds embed the beacon `0xf70d1ed4…991c`, whose owner is the zero address, so the evaluator can't change.

## Order (each step's contract checks the order)

```bash
cd contracts
RPC=https://rpc.xlayer.tech
# 1. deploy (prints AUDIT, REGISTRY, CAMPAIGN)
forge script script/Deploy.s.sol --rpc-url $RPC --account cusity --broadcast
export AUDIT=0x… REGISTRY=0x… CAMPAIGN=0x…

# 2. commit the held-out test set (data/test_leaves.json). Best sent by the PROJECT running the airdrop, from its own
#    keystore: the campaign pins this commit, so the model's author can't grade itself (the site shows who committed it)
STEP=test forge script script/Campaign.s.sol --rpc-url $RPC --account project --broadcast       # -> TEST_COMMIT_ID

# 3. tape out the exact hashed netlist (dry-run first: drop --broadcast to see the fee plan)
PROCESSOR=0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e \
  forge script script/TapeOut.s.sol --rpc-url $RPC --account cusity --broadcast                 # -> circuit id
#    #180 instead: PROCESSOR=0x7335a50819d44402e3D5E00239bBB80A13E7308F BEM_FEE=false  (pays its per-gate fee in OKB)

# 4. register the model (registry re-hashes the processor's bytes; one registration per circuit, ever)
STEP=register PROCESSOR=0x… CIRCUIT_ID=… TEST_COMMIT_ID=… CARD_URI=https://<site>/model/model_card.json \
  forge script script/Campaign.s.sol --rpc-url $RPC --account cusity --broadcast                # -> MODEL_ID

# 5. commit the campaign at least MIN_LEAD (86,400 blocks ≈ 1 day) before its snapshot, pinning the test set
STEP=commit SNAPSHOT_BLOCK=<≥ now + 86400> TEST_COMMIT_ID=… \
  forge script script/Campaign.s.sol --rpc-url $RPC --account project --broadcast              # -> CAMPAIGN_ID
```

After the snapshot block: publish within 7 days (`PUBLISH_WINDOW`), bind within 14 (`BIND_WINDOW`).

```bash
# 6. extract the entrants at the snapshot block with the committed extractor; builds shards + list.json AND
#    inputs.json.gz (every input read), then recomputes every row offline from it as a check
scripts/campaign_snapshot.sh entrants.csv <snapshotBlock> <CAMPAIGN_ID>
# 7. publish the vectors root (the script refuses files made at another block or with another extractor)
STEP=publish CAMPAIGN_ID=… VECTORS_URI=https://<site>/snapshot/list.json \
  forge script script/Campaign.s.sol --rpc-url $RPC --account cusity --broadcast
# 8. bind the campaign to the model (hashes must match; vectors must be published)
STEP=bind CAMPAIGN_ID=… MODEL_ID=… forge script script/Campaign.s.sol --rpc-url $RPC --account cusity --broadcast
```

## DeWEB (the site on chain)

The site can also live in the model circuit's own **container** on TapeOut's DeWEB:
- **Storage:** files are stored on chain through TapeOut's SiteRegistry, each pinned by its SHA-256.
- **Address:** the site is served as `tape://<circuit>.2.<processor#>.tape`.
- **Viewing:** open it through TapeKit, e.g. `https://<circuit>-2-419.tapekit.org/`. TapeKit re-hashes every file it serves.

`scripts/deweb_build.sh` builds the site and leaves four files off chain, linked from GitHub at a pinned commit:
- the 8.8 MB extractor inputs bundle (over DeWEB's 8.4 MB file limit; its SHA-256 *is* on chain);
- `cusity.v`, `sitemap.xml` and `robots.txt` (no DeWEB content type).

```bash
scripts/deweb_build.sh                      # -> build/deweb: 395 files, 3.84 MB, 445 chunk transactions
cd contracts
# dry run: shows what will be written (no transactions)
PROCESSOR=0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e PROCESSOR_NUMBER=419 CIRCUIT_ID=<circuit id from step 3> \
  forge script script/Publish.s.sol --rpc-url https://rpc.xlayer.tech --account cusity
# publish (the signer must hold the circuit, i.e. the wallet that taped it out)
PROCESSOR=0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e PROCESSOR_NUMBER=419 CIRCUIT_ID=<id> \
  forge script script/Publish.s.sol --rpc-url https://rpc.xlayer.tech --account cusity --broadcast --slow
```

**Cost (read on chain and measured on a fork, Nov 19, 2026):**
- **Container:** 0.08 OKB, one time (Opener `FEE`).
- **Name:** free (DomainBinding `monthlyFee` is 0).
- **Uploads:** 2.18 billion gas over 445 transactions ≈ **0.044 OKB** at 0.02 gwei.
- **Total:** ≈ **0.125 OKB**, on top of the tape-out. An unchanged re-publish writes nothing.

**Re-publishing** writes only files whose SHA-256 changed and removes files that are gone, so a model update costs only its changed files.

**From a phone (cloud session, no keystore):** `scripts/publish_deweb.sh` does everything in one go: install tools, check funds, build, tape out, publish, and read every file back.
1. Use a **fresh wallet** holding only ≈ 0.15 OKB + 0.01 BEM on X Layer (or ≈ 0.95 OKB with no BEM).
2. Put its key in the environment's settings as `CUSITY_DEPLOYER_KEY`. Environment variables are stored in plain text and readable by every session on that environment, so remove it afterwards.
3. In a new session, run `scripts/publish_deweb.sh` (dry run), then `scripts/publish_deweb.sh --go`.

**Rehearsed on a mainnet fork** (it published `tape://24.2.419.tape/` on the fork and verified all 395 files): `scripts/deweb_build.sh && FORK=1 forge test --match-contract DewebTest -vv`. It tapes out on #419, publishes every file, reads every file back from the registry, checks its SHA-256, and checks that the name is live.

## Site

1. Set `registry`, `campaign`, `campaignId` and `audit` in `web/src/config.ts`.
   - Live mode turns on only when all three addresses are set.
   - The circuit itself is read from the bound model, and its hash is checked in the browser.
2. Run `scripts/test_all.sh`.
3. Deploy. Vercel builds from `main` automatically. For Netlify, deploy a clean `git archive HEAD` copy.

## Audits

Anyone can run an audit from the Audit page:
1. `requestAudit` records who asked and fixes the next block, whose hash picks the rows.
2. `seal` stores that hash. It must happen within 256 blocks (≈ 4 minutes); after that, finalizing has no deadline.
3. `finalizeAudit` checks each row's positional proof and runs the circuit on chain, 4 rows per transaction.

The site's headline score counts every unsealed (expired) round as 0/16.

**Run the keeper.** Whoever requests a round sees its draw first, and could let a bad one lapse. The keeper
removes that choice: it seals every round of the bound model the moment its block exists, then finalizes it.

`KEEPER_KEY=… AUDIT=… CAMPAIGN=… CAMPAIGN_ID=… npx tsx scripts/audit_keeper.ts`

The keeper needs a *dedicated* hot wallet holding a little OKB. It is never the deployer.

If a test commit claims more rows than its tree holds, anyone can call `proveEmptyRow`. That voids the commit,
so its model can't be audited, and the site says so.

## What the contracts prove, and what they don't

- **Proven on chain:**
  - the circuit is a genuine TapeOut circuit whose netlist hash matches the campaign commit;
  - the campaign was committed ≥ 1 day before its snapshot, naming its extractor and test set;
  - every verdict comes from that circuit on bits in the published tree;
  - audit rows are drawn by a block hash and scored by the circuit.
- **Checkable by anyone, off chain:**
  - every published row recomputes from the published inputs (`scripts/verify_snapshot.sh`);
  - every test row's label can be checked against the public Hop and LayerZero lists (each row names its wallet).
- **Trusted:**
  - **The labels.** The audit score is only as independent as whoever committed the test set, which is why the project, not the model's author, should commit it.
  - **The sequencer.** X Layer's single sequencer could grind a block hash.
  - **The factory owner.** TapeOut's processor factory is an upgradeable proxy owned by a multisig (`0xB3D8…3138`). The registry also pins the processors' code hash, and their beacon's owner is renounced, so an upgrade can't change an accepted processor's evaluator. A malicious factory upgrade combined with a code-identical copy is a residual risk we haven't been able to rule out.
