#!/usr/bin/env bash
# Phase 0, read-only: confirm the TapeOut processor ABI on X Layer and that compiler/tap02.py agrees
# with the chain's eval. Needs cast (Foundry) and python3. Spends nothing.
#   scripts/phase0_check.sh [processor] [circuitId]
set -euo pipefail
cd "$(dirname "$0")/.."
RPC=${XLAYER_RPC:-https://rpc.xlayer.tech}
FACTORY=${FACTORY:-0x1f09daefa827f02cbb40967cc91b259763760761}
echo "chain id: $(cast chain-id --rpc-url "$RPC")   block: $(cast block-number --rpc-url "$RPC")"
echo "processors in factory: $(cast call "$FACTORY" 'cpuCount()(uint256)' --rpc-url "$RPC")"
P=${1:-$(cast call "$FACTORY" 'cpuAt(uint256)(address)' 300 --rpc-url "$RPC")}
ID=${2:-1}
echo "processor $P circuit $ID"
info=$(cast call "$P" 'circuitInfo(uint256)(uint32,uint32,uint32,uint32)' "$ID" --rpc-url "$RPC" | tr '\n' ' ')
read -r nIn nOut nState gates <<< "$info"
echo "circuitInfo: nIn=$nIn nOut=$nOut nState=$nState gates=$gates"
if [ "$nState" != 0 ]; then echo "circuit has latches; pick a combinational one"; exit 1; fi
NL=$(cast call "$P" 'netlist(uint256)(bytes)' "$ID" --rpc-url "$RPC")
bad=0
for i in 1 2 3 4 5 6 7 8; do
  hex=$(python3 -c "import random; n=max(1,$nIn); print('0x'+random.getrandbits(n).to_bytes((n+7)//8,'little').hex())")
  chain=$(cast call "$P" 'eval(uint256,bytes)(bytes)' "$ID" "$hex" --rpc-url "$RPC")
  local_out=$(python3 compiler/tap02_cli.py "$NL" "$nIn" "$nOut" "$hex")
  if [ "$chain" != "$local_out" ]; then echo "MISMATCH input $hex chain $chain local $local_out"; bad=1; fi
done
if [ "$bad" = 0 ]; then echo "OK: eval on chain == compiler/tap02.py on 8 random inputs"; else exit 1; fi
