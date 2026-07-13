/**
 * Chainlink AggregatorV3Interface ABI
 *
 * Step: D4-B-2b (PriceOracleService)
 *
 * Minimal subset for reading the latest price round + feed decimals. Used by
 * `PriceOracleService` to resolve WETH/WBNB (and via stable feeds) to USD.
 *
 * `latestRoundData()` returns:
 *   (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
 * For USD-quoted feeds `answer` has `decimals()` precision (typically 8).
 *
 * Reference: https://docs.chain.link/data-feeds/api-reference
 */
export const AggregatorV3ABI = [
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'description',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'version',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { internalType: 'uint80', name: 'roundId', type: 'uint80' },
      { internalType: 'int256', name: 'answer', type: 'int256' },
      { internalType: 'uint256', name: 'startedAt', type: 'uint256' },
      { internalType: 'uint256', name: 'updatedAt', type: 'uint256' },
      { internalType: 'uint80', name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
