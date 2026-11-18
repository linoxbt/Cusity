# On-chain runbook (needs your deployer key and OKB)

Everything off chain is built and tested (`scripts/test_all.sh`). The steps below sign transactions on
X Layer mainnet, so they run on your machine with your key. Do them in order and paste every
transaction hash into `build/deploy_log.md`.

**Setup.** Copy `.env.example` to `.env` and fill in `PRIVATE_KEY`, using a fresh wallet that holds
only this project's OKB. Then:

```bash
set -a; source .env; set +a
git clone --recurse-submodules https://github.com/Cheeeeez/tapesynth ../tapesynth
(cd ../tapesynth && npm install && npm run build:libs)
./tapesynth --help          # confirms the wrapper finds the CLI
scripts/phase0_check.sh     # read-only: processor ABI and evaluator vs chain
```

## Measured on an X Layer mainnet fork (Nov 18, nothing broadcast)

`FORK=1 forge test --match-contract ForkTest -vv` (contracts/test/Fork.t.sol) runs these against live contracts:

- **Our toy netlist tapes out on a live processor** (#300, `0x9b82…3281`): circuit info, netlist bytes and sha256 match
  `build/toy.netlist.json`, and the live `eval` returns the same verdict and margin as `compiler/tap02.py` on all fixture vectors.
- **Real prices on processor #300:** mint price 0.00066 OKB plus protocol fee 0.00066 OKB per transistor, and `TAPEOUT_FEE` 0.0013 OKB.
  The 251-gate toy cost **0.3326 OKB** on the fork. The spec's 0.000066 figure was 10× too low.

  | Gates | Cost on #300 | At OKB ≈ $86 |
  |---|---|---|
  | 251 (toy) | 0.33 OKB | ≈ $29 |
  | 1,000 | 1.32 OKB | ≈ $114 |
  | 3,000 | 3.96 OKB | ≈ $341 |

- **Gas:** the live `eval` costs ≈ 599k gas for 251 gates (≈ 2,400 per gate), so ≈ 7.2M at 3,000 gates. The X Layer block gas limit is 210M,
  so a K = 16 audit (≈ 115M) fits in one transaction.
- **Prices vary by processor.** #0 and #400 are sold out; #427 lists a near-zero price but its older transistor contract rejects mints.
- **Your own processor** is the cheap route: the factory now caps the mint price at 1e12 wei and charges a tiny protocol fee. Its deploy
  fee is paid in the **BEM** token (`0x60e6…3952`, 8 decimals), so you'd need some BEM first; `createCPU` with OKB alone reverts.
  TapeSynth's `processor create` handles this. Settings are permanent, so pick name, supply and price carefully.

**Budget advice:** keep the model small (the sweep already prefers the smallest circuit on ties). Tape out the toy circuit only once,
and consider your own processor before the 1,000+ gate model.

## Cheapest route (scan of all 430 processors, verified on a mainnet fork)

`npx tsx build/tmp/scan_cpus.ts`-style scan + `FORK=1 forge test --match-test test_tapeoutV1OnFork -vv`:

| Processor | Mint price | Fee | v2 (646 gates) total | Verified |
|---|---|---|---|---|
| **#419** `0xf70d…3c4e` / **#422** `0x5509…37d3` | 0 | 0.01 BEM (approve first) | **0.0013 OKB + 0.01 BEM** | ✅ fork |
| #180 `0x7335…308F` | 0 | 0.00066 OKB per gate | 0.428 OKB | ✅ fork |
| #300 `0x9b82…3281` | 0.00066 OKB | 0.00066 OKB per gate | 0.854 OKB | ✅ fork |

Gas on X Layer (≈ 0.02 gwei) is negligible: deploying all three contracts plus a 16-row audit is under 0.001 OKB.
The 0.08 OKB DeWEB container is optional (the site is already on Vercel and Netlify).

**So a deployer wallet needs about 0.02 OKB plus 0.01 BEM on X Layer.** BEM's home chain is BNB Chain
(`0x5ce0…695a`); the X Layer token (`0x60e6…3952`) is its LayerZero bridge copy. Before minting on #419/#422,
approve the processor's transistor contract to spend BEM.

## Phase 1: hello-world tape-out (cheap, tells you the real price per gate)

```bash
echo 'module xor2(input a, input b, output y); assign y = a ^ b; endmodule' > build/xor.v
./tapesynth synth build/xor.v --top xor2 --objective area --out build/xor.tsyn.json
./tapesynth tapeout build/xor.tsyn.json --processor $PROCESSOR --mint      # NO --yes: read the fee plan first
./tapesynth verify $PROCESSOR <id> --against build/xor.tsyn.json
cast call $PROCESSOR "eval(uint256,bytes)(bytes)" <id> 0x01 --rpc-url $XLAYER_RPC   # expect 0x01
cast call $PROCESSOR "eval(uint256,bytes)(bytes)" <id> 0x03 --rpc-url $XLAYER_RPC   # expect 0x00
```

Check which field in `build/xor.tsyn.json` holds the netlist bytes, and tell `compiler/tap02.py`
(`load_netlist_hex`) if it isn't one of `netlist`, `netlistHex`, `bytes` or `hex`.

## Phase 2: toy model on chain (the Nov 22 gate)

```bash
./tapesynth synth build/toy.v --top cusity --objective area --out build/toy.tsyn.json
python compiler/parity.py --ckpt model/toy.pt --netlist build/toy.tsyn.json --data data/toy_test.jsonl   # must be 0
./tapesynth tapeout build/toy.tsyn.json --processor $PROCESSOR --mint
./tapesynth verify $PROCESSOR <toyId> --against build/toy.tsyn.json
# eval gas on the REAL processor, which sets AUDIT_K below (the test reference processor uses ~1,950 gas/gate):
cast estimate $PROCESSOR "eval(uint256,bytes)" <toyId> 0x0107010303010101 --rpc-url $XLAYER_RPC
```

Pick `AUDIT_K` so that `K × eval gas (3,000-gate model) + ~60k × K` fits comfortably under X Layer's
block gas limit (`cast block latest gasLimit --rpc-url $XLAYER_RPC`).

## Phase 3–5: contracts and the test-set commit

```bash
cd contracts && AUDIT_K=16 forge script script/Deploy.s.sol --rpc-url $XLAYER_RPC --broadcast && cd ..
# put AUDIT, REGISTRY, CAMPAIGN in .env and web/src/config.ts
npx tsx data/merkle.ts test data/test.jsonl               # -> data/test_leaves.json
cast send $AUDIT "commitTestSet(bytes32,uint32)" <root> <size> --rpc-url $XLAYER_RPC --private-key $PRIVATE_KEY
```

## Phase 6–8: campaign (commit → snapshot → tape-out → bind)

```bash
# Before the snapshot: freeze data/extractor.config.json, then
EXT=$(npx tsx data/extractor_hash.ts)
NLH=$(python -c "import sys; sys.path.insert(0,'compiler'); import tap02; print(tap02.netlist_sha256(tap02.load_netlist_hex('build/cusity.tsyn.json')))")
cast send $CAMPAIGN "commit(bytes32,bytes32,uint64)" $NLH $EXT <snapshotBlock> --rpc-url $XLAYER_RPC --private-key $PRIVATE_KEY

# After the snapshot:
npx tsx data/indexer.ts --from <scanFromBlock> --to <snapshotBlock>
npx tsx data/extract.ts --wallets build/entrants.csv --block <snapshotBlock> --out build/snapshot.jsonl
npx tsx data/merkle.ts snapshot build/snapshot.jsonl <campaignId>      # -> build/snapshot_vectors.json
cast send $CAMPAIGN "publishVectors(uint256,bytes32,string)" <campaignId> <root> "<DeWEB url>/snapshot_vectors.json" --rpc-url $XLAYER_RPC --private-key $PRIVATE_KEY

# Tape out the EXACT committed netlist, register, bind:
./tapesynth tapeout build/cusity.tsyn.json --processor $PROCESSOR --mint && ./tapesynth verify $PROCESSOR <id> --against build/cusity.tsyn.json
cast send $REGISTRY "register(address,uint256,bytes32,uint256,string)" $PROCESSOR <id> $EXT <testCommitId> "<cardURI>" --rpc-url $XLAYER_RPC --private-key $PRIVATE_KEY
cast send $CAMPAIGN "bind(uint256,uint256)" <campaignId> <modelId> --rpc-url $XLAYER_RPC --private-key $PRIVATE_KEY
```

If `bind` reverts with `NetlistMismatch`, the taped-out netlist isn't the committed one. Don't
re-commit: tape out the exact committed `.tsyn.json`. If it reverts with `TestSetAfterCommit`, the test
set was committed after the campaign, so commit the test set first next time.

## Site

```bash
cp build/snapshot_vectors.json web/public/ && cp data/test_leaves.json web/public/
# set processor, circuitId, modelId, registry, campaign, campaignId, audit, containerId in web/src/config.ts
npm run -w web build      # -> web/dist, then publish web/dist to the model's Container on DeWEB (0.08 OKB)
```

The site switches from demo to live mode automatically once `campaign` is set.
