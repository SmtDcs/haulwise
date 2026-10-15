#!/usr/bin/env bash
# Deploys CargoBill (Haulwise escrow) to Arc testnet from the haulwise-testnet-deployer keystore.
set -euo pipefail
cd "$(dirname "$0")/../.."
DEPLOYER=$(cast wallet address --account haulwise-testnet-deployer --password-file /workspace/.secrets/haulwise-testnet-deployer.pw)
forge create contracts/CargoBill.sol:CargoBill \
  --rpc-url https://rpc.testnet.arc.io \
  --account haulwise-testnet-deployer --password-file /workspace/.secrets/haulwise-testnet-deployer.pw \
  --broadcast --constructor-args 0x3600000000000000000000000000000000000000 "$DEPLOYER" "$DEPLOYER"
