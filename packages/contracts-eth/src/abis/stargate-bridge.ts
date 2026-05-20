/**
 * Stargate V2 Bridge ABI
 *
 * Step: DEX-2-1-BRIDGE-STG
 *
 * Stargate V2 uses LayerZero V2 for cross-chain messaging.
 * Key contracts:
 * - StargateRouterV2: entry point on each chain for bridge swaps
 * - OFT (Omnichain Fungible Token): token contracts that support native bridging
 *
 * Stargate V2 supports pooled liquidity with:
 * - Bus-based dispatch (batching multiple transfers)
 * - Fee model: protocol fee + lzRelay fee
 *
 * References:
 * - https://stargateprotocol.gitbook.io/stargate/v2
 * - https://github.com/stargate-protocol/stargate-v2
 */

/**
 * Stargate V2 Router ABI — minimal subset for swap
 *
 * swap() signature:
 *   swap(
 *     address token,       // token address on source chain
 *     uint256 amountLD,    // amount in local decimals
 *     uint256 minAmountLD, // minimum amount (slippage protection)
 *     address receiver,    // recipient on destination chain
 *   ) external payable returns (uint256 amountLD)
 *
 * The payable ETH covers LayerZero relay fees.
 */
export const StargateRouterV2ABI = [
  // swap — bridge tokens cross-chain
  'function swap(address token, uint256 amountLD, uint256 minAmountLD, address receiver) external payable returns (uint256 amountLD)',

  // quote layerZero fee for a swap
  'function quoteLayerZeroFee(uint16 dstChainId, address token, uint256 amountLD, address receiver) external view returns (uint256 fee)',

  // Events
  'event Swap(address indexed token, address indexed sender, address indexed receiver, uint256 amountLD, uint256 minAmountLD, uint256 fee)',

  // Bus events (batched execution)
  'event RideBus(address indexed token, address indexed sender, uint256 amountLD, uint256 busId)',

  // View helpers
  'function getPool(address token) external view returns (address pool)',
  'function getBus(address token) external view returns (address bus)',

  // Token config
  'function tokenConfig(address token) external view returns (bool active, uint256 eqFeeBP, uint256 eqRewardBP, uint256 popFeeBP, uint256 discountBP)',
] as const;

/**
 * Simplified ABI fragment for encoding swap calldata
 */
export const StargateSwapFragment = [
  'function swap(address token, uint256 amountLD, uint256 minAmountLD, address receiver) external payable returns (uint256)',
] as const;