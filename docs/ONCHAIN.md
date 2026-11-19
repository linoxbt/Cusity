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

## Measured on a mainnet fork (Nov 19, 2026, model v3, 993 NAND gates)

| | |
|---|---|
| Tape-out on #419 / #422 | 0.0013 OKB + 0.01 BEM (mint price 0) |
| Tape-out on #180 | ≈ 0.657 OKB (0.00066 OKB per gate + 0.0013) |
| Tape-out on #300 | ≈ 1.312 OKB |
| `verdictOf` (free, `eth_call`) | 2.28M gas |
| `finalizeAudit`, K = 16 | 36.5M gas (block gas limit 210M) |
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

# 2. commit the held-out test set (data/test_leaves.json; must precede the campaign commit)
STEP=test forge script script/Campaign.s.sol --rpc-url $RPC --account cusity --broadcast       # -> TEST_COMMIT_ID

# 3. tape out the exact hashed netlist (dry-run first: drop --broadcast to see the fee plan)
PROCESSOR=0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e \
  forge script script/TapeOut.s.sol --rpc-url $RPC --account cusity --broadcast                 # -> circuit id
#    #180 instead: PROCESSOR=0x7335a50819d44402e3D5E00239bBB80A13E7308F BEM_FEE=false

# 4. register the model (registry re-hashes the processor's bytes; one block after the test commit)
STEP=register PROCESSOR=0x… CIRCUIT_ID=… TEST_COMMIT_ID=… CARD_URI=https://<site>/model/model_card.json \
  forge script script/Campaign.s.sol --rpc-url $RPC --account cusity --broadcast                # -> MODEL_ID

# 5. commit the campaign BEFORE its snapshot block (netlist + extractor hash from build/model_card.json)
STEP=commit SNAPSHOT_BLOCK=<future block> forge script script/Campaign.s.sol --rpc-url $RPC --account cusity --broadcast   # -> CAMPAIGN_ID
```

After the snapshot block, and within 7 days (`PUBLISH_WINDOW`):

```bash
# 6. extract the entrants at the snapshot block with the committed extractor, build shards + list.json
scripts/campaign_snapshot.sh entrants.csv <snapshotBlock> <CAMPAIGN_ID>
# 7. publish the vectors root (the script refuses files made at another block or with another extractor)
STEP=publish CAMPAIGN_ID=… VECTORS_URI=https://<site>/snapshot/list.json \
  forge script script/Campaign.s.sol --rpc-url $RPC --account cusity --broadcast
# 8. bind the campaign to the model (hashes must match; vectors must be published)
STEP=bind CAMPAIGN_ID=… MODEL_ID=… forge script script/Campaign.s.sol --rpc-url $RPC --account cusity --broadcast
```

## Site

1. Set `registry`, `campaign`, `campaignId` and `audit` in `web/src/config.ts`.
   - Live mode turns on only when all three addresses are set.
   - The circuit itself is read from the bound model, and its hash is checked in the browser.
2. Run `scripts/test_all.sh`.
3. Deploy. Vercel builds from `main` automatically. For Netlify, deploy a clean `git archive HEAD` copy.

## Audits

Anyone can run an audit from the Audit page:
- **Request:** `requestAudit` records who asked. The next block's hash will pick the rows.
- **Seal:** `seal` stores that hash. It must be called within 256 blocks (≈ 4 minutes on X Layer); after that, finalizing has no deadline.
- **Finalize:** `finalizeAudit` checks each row's positional proof and runs the circuit on chain.

Rounds nobody sealed show as expired. The site counts each one as 0/16, so a bad draw can't be buried.
