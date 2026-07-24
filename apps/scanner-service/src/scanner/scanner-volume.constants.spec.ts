import { id } from 'ethers';

import {
  blockWindowFor,
  CHAIN_BLOCK_TIME_SECONDS,
  DEFAULT_V2_WINDOW_SECONDS,
  MAX_V2_LOG_BLOCK_WINDOW,
  V2_SWAP_EVENT_SIGNATURE,
  V2_SWAP_TOPIC0,
  V3_SWAP_EVENT_SIGNATURE,
  V3_SWAP_TOPIC0,
} from './scanner-volume.constants';
import { ChainId } from '@arbibot/contracts-eth';

describe('Scanner volume constants', () => {
  describe('Swap topic0 (computed via ethers.id, not hardcoded)', () => {
    it('V2_SWAP_TOPIC0 === ethers.id(V2_SWAP_EVENT_SIGNATURE)', () => {
      expect(V2_SWAP_TOPIC0).toBe(id(V2_SWAP_EVENT_SIGNATURE));
    });

    it('V3_SWAP_TOPIC0 === ethers.id(V3_SWAP_EVENT_SIGNATURE)', () => {
      expect(V3_SWAP_TOPIC0).toBe(id(V3_SWAP_EVENT_SIGNATURE));
    });

    it('V2 and V3 topic0 are different (different signatures)', () => {
      expect(V2_SWAP_TOPIC0).not.toBe(V3_SWAP_TOPIC0);
    });

    it('topic0 are 0x-prefixed 66-char hex (32 bytes)', () => {
      expect(V2_SWAP_TOPIC0).toMatch(/^0x[0-9a-f]{64}$/);
      expect(V3_SWAP_TOPIC0).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  describe('blockWindowFor (time → bounded block count)', () => {
    it('converts 1h window per chain block time', () => {
      // Arbitrum ~0.27s → ~13_333 blocks/h
      const arb = blockWindowFor(ChainId.ARBITRUM_ONE_MAINNET, DEFAULT_V2_WINDOW_SECONDS);
      expect(arb).toBeGreaterThan(10_000);
      expect(arb).toBeLessThanOrEqual(MAX_V2_LOG_BLOCK_WINDOW);

      // Base ~2s → 1_800 blocks/h
      const base = blockWindowFor(ChainId.BASE_MAINNET, DEFAULT_V2_WINDOW_SECONDS);
      expect(base).toBe(1_800);

      // BNB ~3s → 1_200 blocks/h
      const bnb = blockWindowFor(ChainId.BNB_CHAIN_MAINNET, DEFAULT_V2_WINDOW_SECONDS);
      expect(bnb).toBe(1_200);
    });

    it('clamps to MAX_V2_LOG_BLOCK_WINDOW on fast chains', () => {
      // Arbitrum 24h would be ~320_000 blocks — must clamp to 14_400.
      const window = blockWindowFor(ChainId.ARBITRUM_ONE_MAINNET, 86_400);
      expect(window).toBe(MAX_V2_LOG_BLOCK_WINDOW);
    });

    it('returns at least 1 block for tiny windows', () => {
      expect(blockWindowFor(ChainId.BNB_CHAIN_MAINNET, 0)).toBe(1);
    });

    it('falls back to 2s block time for unknown chain', () => {
      const blocks = blockWindowFor(999_999, 3_600);
      expect(blocks).toBe(1_800); // 3600 / 2
    });
  });

  describe('CHAIN_BLOCK_TIME_SECONDS', () => {
    it('has entries for all supported chains', () => {
      expect(CHAIN_BLOCK_TIME_SECONDS.has(ChainId.ARBITRUM_ONE_MAINNET)).toBe(true);
      expect(CHAIN_BLOCK_TIME_SECONDS.has(ChainId.BASE_MAINNET)).toBe(true);
      expect(CHAIN_BLOCK_TIME_SECONDS.has(ChainId.BNB_CHAIN_MAINNET)).toBe(true);
    });
  });
});
