/**
 * Uniswap V3 SwapRouter02 ABI
 * Source: https://docs.uniswap.org/contracts/v3/reference/deployments
 *
 * Minimal ABI for single-pool exactInputSingle / exactOutputSingle + multicall + WETH hooks.
 * Multi-hop exactInput / exactOutput deferred to a later iteration (see DEX-1-1-ADAPTER-UNI3).
 */
export const UniswapV3RouterABI = [
  // ── WETH helpers ──
  {
    inputs: [],
    name: 'WETH9',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'value', type: 'uint256' }],
    name: 'refundETH',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amountMinimum', type: 'uint256' },
      { internalType: 'address', name: 'recipient', type: 'address' },
    ],
    name: 'sweepToken',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amountMinimum', type: 'uint256' },
      { internalType: 'address', name: 'recipient', type: 'address' },
    ],
    name: 'unwrapWETH9',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  // ── Multicall ──
  {
    inputs: [{ internalType: 'bytes[]', name: 'data', type: 'bytes[]' }],
    name: 'multicall',
    outputs: [{ internalType: 'bytes[]', name: 'results', type: 'bytes[]' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
      { internalType: 'bytes[]', name: 'data', type: 'bytes[]' },
    ],
    name: 'multicall',
    outputs: [{ internalType: 'bytes[]', name: 'results', type: 'bytes[]' }],
    stateMutability: 'payable',
    type: 'function',
  },
  // ── Exact Input Single ──
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct ISwapRouter.ExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInputSingle',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
  // ── Exact Output Single ──
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
          { internalType: 'uint256', name: 'amountInMaximum', type: 'uint256' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct ISwapRouter.ExactOutputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactOutputSingle',
    outputs: [{ internalType: 'uint256', name: 'amountIn', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
  // ── Exact Input (multi-hop) ──
  {
    inputs: [
      {
        components: [
          { internalType: 'bytes', name: 'path', type: 'bytes' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint256', name: 'amountOutMinimum', type: 'uint256' },
        ],
        internalType: 'struct ISwapRouter.ExactInputParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInput',
    outputs: [{ internalType: 'uint256', name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
  // ── Exact Output (multi-hop) ──
  {
    inputs: [
      {
        components: [
          { internalType: 'bytes', name: 'path', type: 'bytes' },
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
          { internalType: 'uint256', name: 'amountInMaximum', type: 'uint256' },
        ],
        internalType: 'struct ISwapRouter.ExactOutputParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactOutput',
    outputs: [{ internalType: 'uint256', name: 'amountIn', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;
