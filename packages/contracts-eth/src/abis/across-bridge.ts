/**
 * Across Protocol Bridge ABI
 *
 * Step: DEX-2-1-BRIDGE-ACROSS
 *
 * Across is an optimistic bridge that uses bonded relayers for fast cross-chain transfers.
 * Key contracts:
 * - SpokePool: entry point on each chain for deposit/withdrawal
 * - Across relayer monitors and fills deposits on destination chain
 *
 * References:
 * - https://docs.across.to/
 * - https://github.com/Across-Protocol/across-v2
 */

/**
 * Across SpokePool ABI — minimal subset for depositV3
 *
 * depositV3 signature:
 *   depositV3(
 *     address depositor,       // sender
 *     address recipient,       // recipient on destination chain
 *     address inputToken,      // token to bridge
 *     address outputToken,     // token to receive on destination
 *     uint256 inputAmount,     // amount to bridge
 *     uint256 outputAmount,    // min output (slippage protection)
 *     uint256 destinationChainId,
 *     address exclusiveRelayer,// 0x0 for any relayer
 *     uint32  quoteTimestamp,  // timestamp of the quote
 *     uint32  fillDeadline,    // deadline for relayer to fill
 *     uint32  exclusivityDeadline, // 0 for no exclusivity
 *     bytes   message          // empty bytes for simple bridge
 *   )
 */
export const AcrossSpokePoolABI = [
  // depositV3
  'function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) external payable returns (bytes32 depositId)',

  // Events
  'event V3FundsDeposited(bytes32 indexed depositId, address indexed depositor, address indexed recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message)',

  'event FilledV3Relay(bytes32 indexed depositId, address indexed depositor, address indexed recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 repayAmount, uint256 destinationChainId, address relayer, bytes message, uint256 filledAmount)',

  // View functions
  'function filledDeposits(bytes32 depositId) external view returns (uint256)',

  // Deposit quote time helper
  'function getCurrentTime() external view returns (uint32)',
] as const;

/**
 * Simplified ABI fragment for encoding depositV3 calldata
 */
export const AcrossSpokePoolDepositV3Fragment = [
  'function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) external payable returns (bytes32)',
] as const;