import { ChainId, isMainnet, isTestnet } from './types/chain-id';
import {
  UniswapV2RouterABI,
  UniswapV3RouterABI,
  SushiSwapRouterABI,
  ERC20ABI,
} from './index';

describe('@arbibot/contracts-eth', () => {
  it('exports ChainId enum with expected values', () => {
    expect(ChainId.ARBITRUM_ONE_MAINNET).toBe(42161);
    expect(ChainId.BASE_MAINNET).toBe(8453);
    expect(ChainId.BNB_CHAIN_MAINNET).toBe(56);
  });

  it('exports isMainnet / isTestnet helpers', () => {
    expect(isMainnet(ChainId.ARBITRUM_ONE_MAINNET)).toBe(true);
    expect(isTestnet(ChainId.ARBITRUM_ONE_SEPOLIA)).toBe(true);
  });

  it('exports ABIs as non-empty arrays', () => {
    expect(Array.isArray(UniswapV2RouterABI)).toBe(true);
    expect(UniswapV2RouterABI.length).toBeGreaterThan(0);

    expect(Array.isArray(UniswapV3RouterABI)).toBe(true);
    expect(UniswapV3RouterABI.length).toBeGreaterThan(0);

    expect(Array.isArray(SushiSwapRouterABI)).toBe(true);
    expect(SushiSwapRouterABI.length).toBeGreaterThan(0);

    expect(Array.isArray(ERC20ABI)).toBe(true);
    expect(ERC20ABI.length).toBeGreaterThan(0);
  });
});