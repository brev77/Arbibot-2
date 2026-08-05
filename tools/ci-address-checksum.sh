#!/usr/bin/env bash
# CI guard: verify all addresses in packages/contracts-eth/src/addresses/*.ts pass
# EIP-55 checksum validation. ethers v6 rejects bad-checksum addresses with
# INVALID_ARGUMENT, which silently breaks every on-chain call (Chainlink feeds,
# DEX routers, token contracts). This catches the class of bug that took down
# live trading on 2026-08-05 (corrupted Chainlink ETH/USD address).
#
# Run: bash tools/ci-address-checksum.sh
# Exit: 0 = all OK, 1 = at least one bad address.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules/ethers ]; then
  echo "[ci-address-checksum] ethers not installed — skip (dev-only guard)" >&2
  exit 0
fi

node tools/verify-address-checksum.mjs
