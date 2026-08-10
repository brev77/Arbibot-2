import { Logger } from '@nestjs/common';
import { Contract } from 'ethers';
import {
  Address,
  ChainId,
  getArbitrumAddresses,
  getBaseAddresses,
  getBnbAddresses,
} from '@arbibot/contracts-eth';
import type { SelectedWallet } from '../wallet-manager.service';

/**
 * Native-wrap helper (PLAN13 #51 — `FUNC-WRAP-NATIVE-BEFORE-SWAP`).
 *
 * DEX routers operate on ERC20 tokens: `swapExactTokensForTokens` calls `transferFrom(tokenIn,
 * trader, ...)`, which requires the trader to hold a WETH (or WBNB) **balance**, not naked ETH.
 * The live wallet on Arbitrum is funded with ETH only (0 WETH), so every swap whose `tokenIn`
 * is the wrapped native failed with `TransferHelper: TRANSFER_FROM_FAILED` — the router could
 * not pull WETH the wallet never wrapped.
 *
 * This helper wraps the shortfall: if `tokenIn` is the chain's wrapped-native AND the wallet's
 * WETH balance is below `amountIn`, it sends a `WETH.deposit({value: shortfall})` tx so the
 * subsequent swap has the ERC20 balance it needs. The wrap is idempotent: when the balance is
 * already sufficient (e.g. a prior wrap, or received WETH from a previous leg) it is a no-op.
 *
 * Call this in each DEX adapter's `submitLeg` right before `ensureApproval`, only when
 * `tokenIn` is the wrapped native (other tokens are already ERC20 balances). The helper is
 * safe to call on the sell leg too — after a buy leg the wallet holds WETH, so the balance
 * check short-circuits to a no-op.
 */

const logger = new Logger('NativeWrap');

/** Minimal WETH9 ABI: `deposit()` payable + `balanceOf(address)`. */
const WETH9_ABI = [
  'function deposit() payable',
  'function balanceOf(address) view returns (uint256)',
] as const;

/** Per-chain wrapped-native (WETH/WBNB) address; null for unsupported chains. */
function getWrappedNativeAddress(chainId: number): Address | null {
  try {
    switch (chainId) {
      case Number(ChainId.ARBITRUM_ONE_MAINNET):
      case Number(ChainId.ARBITRUM_ONE_SEPOLIA):
        return getArbitrumAddresses(chainId).weth;
      case Number(ChainId.BASE_MAINNET):
      case Number(ChainId.BASE_SEPOLIA):
        return getBaseAddresses(chainId).weth;
      case Number(ChainId.BNB_CHAIN_MAINNET):
      case Number(ChainId.BNB_CHAIN_TESTNET):
        return getBnbAddresses(chainId).wbnb;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export interface NativeWrapArgs {
  chainId: number;
  tokenIn: Address;
  amountIn: string;
  wallet: SelectedWallet;
}

/**
 * If `tokenIn` is the wrapped native and the wallet's wrapped balance is below `amountIn`,
 * wrap the shortfall by sending `WETH.deposit({ value })`. No-op otherwise (non-native
 * tokenIn, or balance already sufficient). Never throws on insufficient ETH — the subsequent
 * swap tx will fail with a clear gas-estimation error instead.
 */
export async function ensureWrappedNativeBalance(args: NativeWrapArgs): Promise<void> {
  const { chainId, tokenIn, amountIn, wallet } = args;
  const wrappedNative = getWrappedNativeAddress(chainId);
  // Not a wrapped-native swap (e.g. USDC → CRV) — nothing to wrap.
  if (wrappedNative === null || tokenIn.toLowerCase() !== wrappedNative.toLowerCase()) {
    return;
  }

  const weth = new Contract(wrappedNative, WETH9_ABI, wallet.wallet) as unknown as {
    balanceOf(addr: string): Promise<bigint>;
    deposit(): Promise<{ wait(): Promise<{ status: number; hash?: string }> }>;
  };

  // Read the current WETH balance. If the read fails (e.g. the wallet runner has no provider
  // in a unit test, or a transient RPC error), we cannot know the shortfall — let the swap
  // proceed and fail with a clear error if WETH is genuinely missing. This keeps the helper
  // non-blocking rather than hard-failing on a read.
  let currentBalance: bigint;
  try {
    currentBalance = await weth.balanceOf(wallet.address);
  } catch (e) {
    logger.warn(
      `WETH balanceOf failed (wallet=${wallet.address}, chain=${chainId}): ` +
        `${e instanceof Error ? e.message : String(e)} — skipping wrap check`,
    );
    return;
  }
  const required = BigInt(amountIn);
  if (currentBalance >= required) {
    // Balance already sufficient (prior wrap, or received from a previous leg).
    return;
  }

  const shortfall = required - currentBalance;
  logger.log(
    `wrapping native: tokenIn=${tokenIn} wallet=${wallet.address} ` +
      `balance=${currentBalance.toString()} required=${required.toString()} ` +
      `shortfall=${shortfall.toString()} chain=${chainId}`,
  );

  // WETH9.deposit() is payable with `msg.value = shortfall`. It mints WETH 1:1 with ETH.
  // No nonce lock here: this is a single pre-swap tx on a freshly-selected wallet, and the
  // adapter's own swap broadcast runs under nonceManager.withBroadcastLock afterwards.
  const tx = await wallet.wallet.sendTransaction({
    to: wrappedNative,
    data: '0xd0e30db0', // deposit() selector
    value: shortfall,
  });
  const receipt = await tx.wait();
  if (receipt === null || receipt.status === 0) {
    throw new Error(
      `native wrap failed: deposit() tx ${tx.hash} status=${receipt?.status ?? 'null'}`,
    );
  }
  logger.log(`wrap confirmed: tx=${tx.hash} wrapped=${shortfall.toString()} chain=${chainId}`);
}
