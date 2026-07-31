/**
 * Uniswap V3 QuoterV2 ABI
 * Source: https://docs.uniswap.org/contracts/v3/reference/deployments
 *
 * Minimal ABI for `quoteExactInputSingle` — the off-chain-readable quote used by
 * the TradeCostEstimatorService to derive an accurate expected output (and thus
 * the pool fee cost) for a V3 swap BEFORE broadcasting. Unlike the V3 SwapRouter,
 * the Quoter is a `view` (technically non-payable, reverts-and-catches) so it is
 * safe to call for estimation without spending gas.
 *
 * Returns the quoted `amountOut` plus the pool's post-swap state, which the
 * adapter uses to compute `amountOutMinimum` (quote − slippage tolerance).
 *
 * Step: cost-estimation (pre-trade quote — replaces the "QuoterV2 deferred"
 * comment in uniswap-v3.adapter.ts).
 */
export const QuoterV2ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct IQuoterV2.QuoteExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
      { internalType: 'uint160', name: 'sqrtPriceX96After', type: 'uint160' },
      { internalType: 'uint32', name: 'initializedTicksCrossed', type: 'uint32' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
