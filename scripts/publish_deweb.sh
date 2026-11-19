#!/usr/bin/env bash
# One command, for a cloud session with no keystore: tape out the model circuit and publish the site to DeWEB,
# signing with the key in $CUSITY_DEPLOYER_KEY (set it in the environment's settings, never in chat or in git).
# Use a fresh wallet holding only what this needs: ~0.15 OKB + 0.01 BEM on X Layer (or ~0.95 OKB and no BEM).
#   scripts/publish_deweb.sh            # dry run: checks funds and shows the plan, sends nothing
#   scripts/publish_deweb.sh --go       # does it
# Re-running is safe: set CIRCUIT_ID to reuse a taped-out circuit; only changed files are written.
set -euo pipefail
set +x   # never echo the key
cd "$(dirname "$0")/.."
GO=${1:-}
KEY=${CUSITY_DEPLOYER_KEY:?set CUSITY_DEPLOYER_KEY in the environment settings (a new session picks it up)}
RPC=${XLAYER_RPC:-https://rpc.xlayer.tech}

# --- tools (a fresh container has none of them)
if ! command -v forge >/dev/null || ! command -v cast >/dev/null; then
  mkdir -p .tools && (cd .tools && [ -f package.json ] || npm init -y >/dev/null) && (cd .tools && npm install --silent @foundry-rs/forge@1.7.1 @foundry-rs/cast@1.7.1 >/dev/null)
  export PATH="$PWD/.tools/node_modules/@foundry-rs/forge-linux-amd64/bin:$PWD/.tools/node_modules/@foundry-rs/cast-linux-amd64/bin:$PATH"
fi
[ -d node_modules ] || npm ci --silent
[ -d contracts/lib/forge-std ] || scripts/setup_contracts.sh >/dev/null

# --- pre-flight: who signs, what they hold, which processor
ME=$(cast wallet address --private-key "$KEY")
BEM=0x60e62Efa9405d6873C5deaBD4E6CC91c25363952
OKB_WEI=$(cast balance "$ME" --rpc-url "$RPC")
BEM_RAW=$(cast call $BEM "balanceOf(address)(uint256)" "$ME" --rpc-url "$RPC" | cut -d' ' -f1)
echo "signer $ME: $(cast from-wei "$OKB_WEI") OKB, $(python3 -c "print($BEM_RAW/1e8)") BEM"
if [ "$BEM_RAW" -ge 1000000 ]; then P=0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e; PN=419; export BEM_FEE=true; NEED=0.15
else P=0x7335a50819d44402e3D5E00239bBB80A13E7308F; PN=180; export BEM_FEE=false; NEED=0.95; fi
python3 -c "import sys; sys.exit(0 if $OKB_WEI >= $NEED*1e18 else 1)" || {
  echo "not enough OKB: processor #$PN needs about $NEED OKB on X Layer (add 0.01 BEM to use #419 for ~0.15 OKB). Send it to $ME and run again."; exit 1; }
echo "plan: processor #$PN ($P), ~$NEED OKB in total"

scripts/deweb_build.sh
cd contracts
if [ -z "${CIRCUIT_ID:-}" ]; then
  if [ "$GO" != "--go" ]; then
    PROCESSOR=$P forge script script/TapeOut.s.sol --rpc-url "$RPC" --private-key "$KEY" 2>&1 | grep -E "processor|mint price|Error|needs|not enough" || true
    echo "dry run only: re-run with --go to tape out and publish"; exit 0
  fi
  OUT=$(PROCESSOR=$P forge script script/TapeOut.s.sol --rpc-url "$RPC" --private-key "$KEY" --broadcast --slow 2>&1) || { echo "$OUT" | tail -20; exit 1; }
  CIRCUIT_ID=$(echo "$OUT" | grep -oE "taped out circuit id [0-9]+" | grep -oE "[0-9]+$")
  echo "taped out circuit #$CIRCUIT_ID on processor #$PN (keep this number: CIRCUIT_ID=$CIRCUIT_ID)"
fi
ARGS=(--rpc-url "$RPC" --private-key "$KEY")
[ "$GO" = "--go" ] && ARGS+=(--broadcast --slow)
OUT=$(PROCESSOR=$P PROCESSOR_NUMBER=$PN CIRCUIT_ID=$CIRCUIT_ID forge script script/Publish.s.sol "${ARGS[@]}" 2>&1) || { echo "$OUT" | grep -vi "private" | tail -20; exit 1; }
echo "$OUT" | grep -E "files written|published:|opened container" || true
[ "$GO" = "--go" ] || { echo "dry run only: re-run with --go"; exit 0; }
cd ..
CONTAINER=$(cast call 0x536adD8F30f03b69f6fbF29d425A816A0dC50106 "accountOf(address,uint256)(address)" "$P" "$CIRCUIT_ID" --rpc-url "$RPC")
npx tsx scripts/verify_deweb.ts "$CONTAINER"
echo "live: https://$CIRCUIT_ID-2-$PN.tapekit.org/   tape://$CIRCUIT_ID.2.$PN.tape/"
