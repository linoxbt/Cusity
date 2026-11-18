# Cusity Build Spec: Review Notes

Review of [`BUILD_SPEC.md`](./BUILD_SPEC.md) (from the Nov 18, 2026 PDF). Where a finding says
**verified**, I checked it against the difflogic 0.1.0 source on PyPI. Everything else comes from
reading the spec's own code and text.

Severity: **🔴 blocker** (the step fails as written) · **🟠 design flaw** (it runs, but the claim it
supports doesn't hold) · **🟡 inconsistency or gap** · **⚪ minor**.

---

## 1. Blockers: the build fails as written

### 🔴 1.1 The training architecture fails difflogic's own check (verified)

`LogicLayer.get_connections` asserts `out_dim * 2 >= in_dim`. The spec's last layer is
`LogicLayer(W, 2·G)`:

| Config | Last layer | Check | Result |
|---|---|---|---|
| Toy (Phase 2): W=64, G=8 | `LogicLayer(64, 16)` | 32 ≥ 64 | **AssertionError** |
| Real (Phase 4): W=256, G=16 | `LogicLayer(256, 32)` | 64 ≥ 256 | **AssertionError** |
| Sweep W=512 | `LogicLayer(512, 32)` | 64 ≥ 512 | **AssertionError** |

The Nov 22 gate (Phase 2) fails at `model = build(...)`.

**Fix:** taper so that each layer is at least half the one before it, for example
`64 → 256 → 128 → 64 → 32` (G=16), or `64 → 64 → 32 → 16` for the toy (G=8). Change `build()` to take
a list of widths instead of one `--width`.

### 🔴 1.2 difflogic won't install or import on a CPU-only machine (verified)

- `setup.py` always builds `CUDAExtension(...)`, so `pip install difflogic` needs `nvcc` and the CUDA toolkit. It also imports `torch` in `setup.py`, so pip's build isolation fails even when torch is already installed.
- `difflogic/difflogic.py` starts with `import difflogic_cuda`, so **`implementation='python'` doesn't avoid the problem**. The import fails before you can choose the implementation.
- `parity.py` reloads the whole pickled module with `torch.load`, which imports difflogic again. That means parity checks fail on CPU-only machines too.

**Fix:** pick one on day 1:
(a) train in a GPU notebook and run parity there as well;
(b) vendor `difflogic.py` and `functional.py` into `model/` and wrap the import in `try: import difflogic_cuda except ImportError: difflogic_cuda = None`;
(c) save only `gates.json` plus a `state_dict`, and make parity rebuild the model from the gate list in pure numpy, which removes torch from the parity step.

### 🔴 1.3 `npx tapesynth` won't find the sibling clone (supply-chain risk)

The bootstrap clones TapeSynth into `../tapesynth`. Running `npx tapesynth …` from `cusity/` then
looks in the npm registry for a package named `tapesynth`. The best case is "not found". The worst
case runs whatever package has that name, while `PRIVATE_KEY` is in your environment.

**Fix:** use `npm link` from the clone, or call it directly (`node ../tapesynth/<bin> …`), and
check that the path resolves before setting `PRIVATE_KEY`.

---

## 2. Design flaws: the code runs, but the claim it supports doesn't hold

### 🟠 2.1 The audit can be gamed by finalizing only good rounds

The spec says "the worst a caller can do is not finalize a round". That is the attack. The test
set is public, so the owner can compute every round's score off chain as soon as the target block
lands. They can then finalize only the good rounds and let the bad ones expire, since `blockhash`
returns zero after 256 blocks. The Audit view then lists a selected set of high scores.

**Fix:** make `requestAudit` and `finalizeAudit` a single atomic call by using `block.prevrandao`
or `blockhash(block.number - 1)` inside `finalizeAudit`, so there is no window to see the result
first. Failing that, show every requested round in the UI, with expired ones marked
"abandoned", and score the model over all requested rounds. On an L2 the sequencer can influence
both values. State that plainly; it's acceptable for v1.

### 🟠 2.2 The feature extractor isn't deterministic per wallet

- **`funderCluster` depends on the population.** `funderCounts` is built only from the wallets passed in, which are the labeled set during training and the entrants at campaign time. The same wallet at the same block gets different bits depending on who else is in the file. This breaks the "same wallet + same block → same bits" claim, the "recompute" link, and the train/serve match.
  **Fix:** count every wallet funded by that funder up to the snapshot block, using the indexer, independent of the input list.
- **Extractor parameters aren't in `extractorHash`.** `okbUsd`, `windowStart`/`windowEnd` and `data/exchanges.json` all change the bits but are passed as CLI arguments or a separate data file. The owner could change them after committing.
  **Fix:** put them in a `extractor.config.json` that is part of the hashed bundle, and define exactly which files the hash covers.
- **Historical state needs an archive node.** `getBalance`, `getTransactionCount`, `getCode` and `balanceOf` at `snapshotBlock` fail on pruned RPCs once the block is more than about 128 blocks old. Phase 3 depends on this, and so does every later rerun.
  **Fix:** confirm on day 1 that an X Layer archive endpoint exists, or read the values at the snapshot and cache them in `data/raw/`.

### 🟠 2.3 The labels leak into the features, so the accuracy number is inflated

Plan B labels bots by "same funder, same timing, same amounts". Those are the `funderCluster`,
`hourSpread`/`burstShare` and `amountRepeat` features. The model will learn your labeling
heuristic, and its "accuracy" will measure agreement with that heuristic rather than with real
bot behaviour. The on-chain audit inherits the problem.

**Fix:** label with signals the model can't see (for example a manual review, or a sweep pattern
across multiple hops), or present the number as "agreement with rule X" in the model card.

### 🟠 2.4 The per-check fee isn't implemented and can't be enforced

The revenue model and video script say that contracts pay per check into the Container, but
`check` and `verdictOf` are `view` functions with no payment. Also, once the netlist is public,
anyone can call `processor.eval` directly, or run the circuit off chain, and skip any fee
wrapper. Revenue really comes from **commissioning and committing filters**, not from metering
checks. Either drop the per-check claim, or charge only for value the wrapper adds, such as
campaign binding and attestations.

### 🟠 2.5 "Deciding gates" will mostly flag the comparator

In a synthesized netlist, every gate on the popcount/comparator path toggles the verdict when you
flip it. Those gates depend on almost every input, so `inputWeight` will be nearly uniform and
the "top 5 reasons" will be noise. Flipping an internal gate also isn't a counterfactual a user
could actually cause.

**Fix:** lead with `flippingInputs`, but flip **thermometer levels** (move a feature one threshold
up or down) instead of single bits. Flipping bit "age > 30" while "age > 7" stays 0 creates an
impossible input. Keep the gate map as a visual, not as the explanation.

### 🟠 2.6 The test-set commitment doesn't prove it was held out

The registry only checks that the test commit happened in an earlier block than registration.
Nothing stops someone from training on the test set and committing it afterwards. You can't fully
fix this on chain. You can make it harder by requiring `testCommit.blockNumber <
campaign.commitBlock` in `bind`. Either way, the model card should say this relies on trust.

---

## 3. Inconsistencies and gaps in the spec

| # | Where | Issue |
|---|---|---|
| 3.1 | Gate compiler, Step 1 snippet | `bot = l3[0..15]`, `human = l3[16..31]` is the **reverse** of `train.py`/A8, where neurons `[0,G)` are class 0 (human). If someone copies the snippet, every verdict is inverted. A8 is correct. |
| 3.2 | Audit view vs contract | "A Run audit button sends **one** audit transaction." It takes **two**: `requestAudit`, then `finalizeAudit` in a later block, and within 256 blocks. If X Layer blocks are about 1 s apart, that is roughly a 4-minute window. Check the block time and design the UI around it. |
| 3.3 | "What v1 is" vs Check view | The spec says "turns *any* X Layer wallet into 64 bits" and "anyone can check a wallet". The page can only check wallets that are in the campaign snapshot. There is no in-browser extractor, because `extract.ts` uses `node:fs` and needs an archive RPC. The tech-stack line "same code runs in the browser" is also inaccurate. |
| 3.4 | Data format #4 vs `merkle.ts` | `snapshot_vectors.json` is specified with `campaignId` and `extractorHash`, but `merkle.ts` writes neither. |
| 3.5 | `extract.ts` | It reads `data/exchanges.json`, which isn't defined in Data formats. |
| 3.6 | Feature table vs code | "Timing regularity: hours **and gaps**", but the code only counts distinct hours. "Balance: native **and stablecoin** buckets" is computed as a single USD sum. |
| 3.7 | `hasName` | Always `false`, so one of the 64 bits is a constant. Replace it with a real feature or drop it (63 bits plus padding). |
| 3.8 | `isContract` | EIP-7702 delegated EOAs have code (`0xef0100…`) and will be flagged as contracts. Decide whether that's intended. |
| 3.9 | Cost section vs Phase 6 | "Tape out the model once" conflicts with Phase 6, which describes a test-campaign tape-out by Nov 29 and a live one by Dec 1. That is two 3,000-gate tape-outs. |
| 3.10 | `AccuracyAudit.K` | Hard-coded to 16 in an immutable contract, while the risk table says "lower k per call" if `eval` gas is too high. Make K a constructor argument, or let `finalizeAudit` accept a batch. |
| 3.11 | `.env` | Phase 0 uses `$FACTORY`, which isn't in the `.env` template. |
| 3.12 | Runbook step 2 | Says to call `setRegistry` manually, but `Deploy.s.sol` already does it. A second call reverts with "locked". This is harmless but confusing. |
| 3.13 | Tape-out outputs | TAP-02 requires outputs to come from elements. If synthesis turns a margin bit into a constant (possible with a degenerate model or a small G), `tapeout` reverts. Check that TapeSynth adds a buffer in that case. |

---

## 4. Schedule and budget

- **Plan B labels don't fit the timeline.** Plan B labels the *campaign's sign-ups*, but the campaign is only announced around Nov 28, while labels are due Nov 26 (Phase 3) and training Nov 25–29 (Phase 4). With Plan B, real training realistically starts around Nov 30, and the commit before the snapshot must land by about Dec 1. That leaves almost no slack before the Dec 1–5 campaign with its 48-hour appeal window. Decide on Plan A or Plan B on Nov 18, as the spec itself says, and if it's Plan B, open sign-ups **now**.
- **Cost estimate** (unconfirmed price of 0.000066 OKB per transistor): 3,000 gates ≈ 0.198 OKB. Add the toy model (about 0.02) and the container fee (0.08), and the total is about **0.3 OKB before gas**, or more if you do two model tape-outs (3.9). At $100/OKB that's about $30; at $170/OKB it already reaches the $50 cap. Check the live OKB price and the TapeSynth plan in Phase 1 before you commit to the second tape-out.
- The spec is dated Nov 18 and the deadline is Dec 7, so there are **19 days**, and the hard gate is in 4 days.

---

## 5. Minor

- `tap02.py` and `tap02.ts` don't validate the netlist. Check `len % 7 == 0` and `a, b < own index`. Right now a forward reference silently reads 0 in TypeScript, or raises IndexError in Python.
- TapeSynth's equivalence check uses 4,096 random vectors. For 64 inputs and about 3,000 gates, a formal check (Yosys `equiv_*` or ABC `cec`) runs in seconds. Add it.
- `toy_data.py` computes quantile thresholds over the whole dataset, including the test rows. That's a small leak; it's fine for a toy model.
- `extract.ts` fetches wallet histories one at a time, and `tsx` doesn't load `.env` on its own (use `dotenv` or `node --env-file`).
- `extract.ts` splits the CSV on `,`. A `note` that contains a comma is harmless (only the first two columns are read), but quoted addresses would break it.
- `web/` imports `../../data/features`, which is outside the Vite root. The dev server needs `server.fs.allow: [".."]`.
- `main.ts` has no error handling. An invalid address makes `getAddress` throw, and the rejection is never caught.
- The audit samples with replacement, so the 16 rows can repeat. With K=16 the score has about ±12 percentage points of sampling noise. Say so next to "x/16".
- `funderOf` only sees native-value transfers from the list of normal transactions. Funding through internal transactions or token transfers (common from exchanges and bridges) is missed.
- **Name change:** "Weightless" was a pun on "no weights file", which the video script still uses ("This model has no weights file…"). That line still works, but the brand no longer echoes it.

---

## 6. What's solid

- Bit packing (LSB-first, byte 0 = bits 0–7) is consistent across `features.ts`, `toy_data.py`, `train.py`, `tap02.*` and the contracts.
- The difflogic op order in A8 matches `bin_op` in `functional.py` exactly (**verified**), and so does `m.indices` (**verified**). Those two VERIFY tags can be removed.
- The Merkle leaf encodings match between `merkle.ts` and the contracts (13 and 28 bytes, so they can't be confused with 64-byte internal nodes), and `SimpleMerkleTree` sorted pairs are compatible with `MerkleProof`.
- The margin fits: with G=16 the range is 16..48 in 6 bits. The tie-break (`c1 > c0`) matches `argmax`.
- The order commit → snapshot → publish vectors → tape-out → register → bind is sound. Having the registry compute the netlist hash on chain is a good choice.
- The "toy model on chain by day 5" gate is the right way to reduce risk, as long as 1.1 and 1.2 are fixed first.

## Priority fixes before Nov 22

1. Taper the architecture (1.1) and fix how difflogic is installed (1.2). Without these, Phase 2 can't run.
2. Run TapeSynth through `npm link` or a direct path (1.3).
3. Swap the Step 1 snippet's groups to match A8 (3.1).
4. Decide on Plan A or B today. If it's B, open sign-ups now (§4).
5. Before deploying contracts: make audits atomic (2.1), make K configurable (3.10), and put extractor parameters in the hash (2.2).
