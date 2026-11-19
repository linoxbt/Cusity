#!/usr/bin/env bash
# Install the Solidity libraries at the exact versions the tests and deployment were checked with.
# contracts/lib is not committed; this makes a fresh clone build:  scripts/setup_contracts.sh && (cd contracts && forge test)
set -euo pipefail
cd "$(dirname "$0")/../contracts"
forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
