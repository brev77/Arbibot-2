import { Injectable, Logger } from '@nestjs/common';
import { getArbitrumAddresses, getBaseAddresses, getBnbAddresses, getOptimismAddresses } from '@arbibot/contracts-eth';

/**
 * TokenResolverService (PLAN10 P10-3, opp-service).
 *
 * Closes the mapping gap between a scanner opportunity and a CreateMultiLegPlanDto.
 *
 * The scanner payload has a known bug (`token = quoteAsset`, both = USDC), so this resolver
 * works **only from `instrumentKey`** (format `arb:{chainId}:{addr0}-{addr1}`), which carries
 * the real token addresses. It also computes pre-quoted `amountIn` values (Модель #1):
 *
 *   buyAmountIn  = notional in quote-token smallest units (e.g. $10 USDC = 10_000_000)
 *   sellAmountIn = expected amountOut from the buy leg = notional / buyPrice × 10^baseDecimals
 *
 * Risk (documented, Модель #1 accepted for MVP): if the buy leg receives less than quoted
 * (real slippage > forecast), the pre-set sell amountIn will exceed the actual received
 * balance → sell tx reverts → stuck-plan-reaper → manual intervention. For $10 notional the
 * loss is gas-only. Recovery path is covered in P10-8 targeted tests.
 *
 * UniV3 fee-tier resolution is Phase 2 (MVP UniV2 venues have no fee tiers).
 */

/** Tokens we can resolve from contracts-eth staple addresses. */
const STAPLE_TICKERS = new Set(['WETH', 'USDC', 'USDT']);

/** Static decimals map for staples (on-chain read is Phase 2 for long-tail). */
const STAPLE_DECIMALS: Record<string, number> = {
  WETH: 18,
  USDC: 6,
  USDT: 6,
};

/**
 * Hard-coded decimals for well-known Arbitrum One token addresses (fix #2).
 *
 * Why: the scanner emits real token addresses in `instrumentKey` (e.g. MAGIC/USDC),
 * not tickers. Without this map, `resolveDecimals` returned null for every address
 * → `resolve()` returned null → LiveAutoDriveWorker skipped every long-tail opp with
 * `skip_no_token`. This is the same set of tokens the PriceOracleService recognises.
 */
const KNOWN_DECIMALS_BY_ADDRESS: Record<string, number> = {
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 18, // WETH
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6, // USDC (native)
  '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 6, // USDC.e (bridged)
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6, // USDT
  '0x912ce59144191c1204e64859c7384b37e22328d5': 18, // ARB
  '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a': 18, // GMX
  '0x539bde0d7dbd336b79148aa742883198bbf60342': 18, // MAGIC
  '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 8, // WBTC
  '0xf97f4df75117a78c1a5a0dbb814af92458539fb4': 18, // LINK
  '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0': 18, // UNI
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 18, // DAI
  '0x11cdb42b0eb46d95f990bedd4695a6e3fa034978': 18, // CRV
  '0x13ad51ed4f1b7e9dc168d8a00cb3f4ddd85efa60': 18, // LDO
};

/** Address regex (EIP-55 not enforced — case-insensitive 40-hex). */
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface ResolvedTokens {
  token0Address: string;
  token1Address: string;
  decimals0: number;
  decimals1: number;
  chainId: number;
}

export interface AmountIns {
  /** Buy leg input amount in smallest token units (bigint string). */
  buyAmountIn: string;
  /** Sell leg input amount in smallest token units (bigint string, pre-quoted). */
  sellAmountIn: string;
}

export interface ResolveResult {
  tokens: ResolvedTokens;
  amountIns: AmountIns;
}

/** Evidence block from the scanner payload (subset we consume). */
export interface OpportunityEvidence {
  /** Buy price (quote per base, e.g. USDC per MAGIC). */
  buyPrice?: number;
  sellPrice?: number;
}

interface AddressBook {
  weth?: string;
  usdc?: string;
  usdt?: string;
}

function pickAddressBook(chainId: number): AddressBook | null {
  try {
    switch (chainId) {
      // PLAN10 scope: single-chain live (Arbitrum). Mainnet addresses only for the MVP
      // — testnet address books have narrower ChainId enums in contracts-eth and cross-
      // chain is out of scope. Operators test on mainnet with $1-10 notional (smoke).
      case 42161:
        return getArbitrumAddresses(42161);
      case 8453:
        return getBaseAddresses(8453);
      case 56:
        return getBnbAddresses(56);
      case 10:
        return getOptimismAddresses(10);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function tickerToAddress(ticker: string, book: AddressBook): string | null {
  const t = ticker.toUpperCase();
  switch (t) {
    case 'WETH':
      return typeof book.weth === 'string' && book.weth.length > 0 ? book.weth : null;
    case 'USDC':
      return typeof book.usdc === 'string' && book.usdc.length > 0 ? book.usdc : null;
    case 'USDT':
      return typeof book.usdt === 'string' && book.usdt.length > 0 ? book.usdt : null;
    default:
      return null;
  }
}

function tickerToDecimals(ticker: string): number | null {
  const t = ticker.toUpperCase();
  return STAPLE_DECIMALS[t] ?? null;
}

/**
 * Parse an instrumentKey of form `arb:{chainId}:{pair}` where pair is either
 * `0xADDR-0xADDR` (scanner-emitted, the correct source) or `TICKER-TICKER` (fallback).
 * Returns null on malformed input or unknown tokens (fail-closed → worker skips).
 */
export function parseInstrumentKey(
  instrumentKey: string,
): { chainId: number; left: string; right: string } | null {
  if (typeof instrumentKey !== 'string' || instrumentKey.length === 0) {
    return null;
  }
  const firstColon = instrumentKey.indexOf(':');
  if (firstColon <= 0) {
    return null;
  }
  const secondColon = instrumentKey.indexOf(':', firstColon + 1);
  if (secondColon <= firstColon + 1) {
    return null;
  }
  const venue = instrumentKey.slice(0, firstColon);
  if (venue !== 'arb') {
    // Only `arb:` keys are supported (scanner emits this prefix).
    return null;
  }
  const chainStr = instrumentKey.slice(firstColon + 1, secondColon);
  const pair = instrumentKey.slice(secondColon + 1);
  const chainId = Number.parseInt(chainStr, 10);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return null;
  }
  const dash = pair.indexOf('-');
  if (dash <= 0 || dash >= pair.length - 1) {
    return null;
  }
  const left = pair.slice(0, dash);
  const right = pair.slice(dash + 1);
  if (left.length === 0 || right.length === 0) {
    return null;
  }
  return { chainId, left, right };
}

@Injectable()
export class TokenResolverService {
  private readonly logger = new Logger(TokenResolverService.name);

  /**
   * Resolve tokens + pre-quoted amountIns from a scanner opportunity.
   * Returns null on any unresolvable input (unknown token, missing price, malformed key)
   * → the worker skips the opportunity (fail-closed, metric skip_no_token / skip_no_price).
   */
  resolve(
    instrumentKey: string,
    notionalUsd: number,
    evidence: OpportunityEvidence | undefined,
  ): ResolveResult | null {
    const parsed = parseInstrumentKey(instrumentKey);
    if (parsed === null) {
      this.logger.debug(`unparseable instrumentKey: ${instrumentKey}`);
      return null;
    }

    const book = pickAddressBook(parsed.chainId);
    if (book === null) {
      this.logger.debug(`no address book for chainId ${parsed.chainId}`);
      return null;
    }

    // token0 = base, token1 = quote (scanner convention: arb:{chain}:{base}-{quote}).
    const token0Address = this.resolveAddress(parsed.left, book);
    const token1Address = this.resolveAddress(parsed.right, book);
    if (token0Address === null || token1Address === null) {
      this.logger.debug(
        `cannot resolve tokens for ${instrumentKey} (non-staple or unknown). Only ${[...STAPLE_TICKERS].join('/')} are MVP-supported.`,
      );
      return null;
    }
    const decimals0 = this.resolveDecimals(parsed.left);
    const decimals1 = this.resolveDecimals(parsed.right);
    if (decimals0 === null || decimals1 === null) {
      return null;
    }

    const tokens: ResolvedTokens = {
      token0Address,
      token1Address,
      decimals0,
      decimals1,
      chainId: parsed.chainId,
    };

    const amountIns = this.computeAmountIns(tokens, notionalUsd, evidence);
    if (amountIns === null) {
      return null;
    }
    return { tokens, amountIns };
  }

  private resolveAddress(token: string, book: AddressBook): string | null {
    // Address form — accept verbatim (checksum-insensitive).
    if (ADDRESS_RE.test(token)) {
      return token;
    }
    // Ticker form — map via staples.
    return tickerToAddress(token, book);
  }

  private resolveDecimals(token: string): number | null {
    if (ADDRESS_RE.test(token)) {
      // Look up known decimals by address (case-insensitive). Covers the Arbitrum One
      // staples + the long-tail tokens the scanner emits. Unknown long-tail addresses
      // still fall through to null → resolve() returns null → worker skips the opp.
      const known = KNOWN_DECIMALS_BY_ADDRESS[token.toLowerCase()];
      if (typeof known === 'number') {
        return known;
      }
      return null;
    }
    return tickerToDecimals(token);
  }

  /**
   * Pre-quoted amountIns (Модель #1).
   *
   * Convention for a 2-leg arb (buy base on venue A, sell base on venue B):
   *   Leg 0 (buy):  tokenIn = quote (USDC), tokenOut = base. amountIn = notional in quote units.
   *   Leg 1 (sell): tokenIn = base, tokenOut = quote. amountIn = expected amountOut of leg 0
   *                 = notional / buyPrice × 10^baseDecimals.
   *
   * `evidence.buyPrice` is quote-per-base (e.g. USDC per MAGIC). If absent → null (skip).
   */
  private computeAmountIns(
    tokens: ResolvedTokens,
    notionalUsd: number,
    evidence: OpportunityEvidence | undefined,
  ): AmountIns | null {
    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
      return null;
    }
    // quote token = token1 (USDC/USDT) — we assume the quote is the stablecoin leg.
    const buyAmountIn = BigInt(Math.round(notionalUsd * 10 ** tokens.decimals1)).toString();

    const buyPrice = evidence?.buyPrice;
    if (typeof buyPrice !== 'number' || !Number.isFinite(buyPrice) || buyPrice <= 0) {
      this.logger.debug('missing/invalid evidence.buyPrice; cannot pre-quote sell amountIn');
      return null;
    }
    // expected base received = notional(quote) / price(quote per base)
    const expectedBase = notionalUsd / buyPrice;
    const sellAmountIn = BigInt(Math.round(expectedBase * 10 ** tokens.decimals0)).toString();
    return { buyAmountIn, sellAmountIn };
  }
}
