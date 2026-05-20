/**
 * Native bridge ABI fragments for official L2 canonical bridges.
 *
 * Step: DEX-2-1-BRIDGE-NATIVE
 *
 * Supports:
 *   - Arbitrum canonical bridge (Inbox depositEth)
 *   - Optimism Standard Bridge (depositERC20, depositETH, withdraw)
 *
 * These are the official bridges built into the L2 protocol.
 * L1→L2 deposits are fast (~10 min), L2→L1 withdrawals have challenge periods (~7 days).
 */

// ───────────────────────────────────────────────────────────────────────
// Arbitrum Inbox — L1 → L2 ETH deposit
// ───────────────────────────────────────────────────────────────────────

export const ArbitrumInboxABI = [
  'function depositEth() external payable returns (uint256)',
  'function createRetryableTicket(address to, uint256 l2CallValue, uint256 maxSubmissionCost, address excessFeeRefundAddress, address callValueRefundAddress, uint256 gasLimit, uint256 maxFeePerGas, uint256 dataLength, bytes data) external payable returns (uint256)',
  'event InboxMessageDelivered(uint256 indexed messageNum, bytes data)',
  'event InboxMessageDeliveredFromOrigin(uint256 indexed messageNum)',
] as const;

// ───────────────────────────────────────────────────────────────────────
// Optimism Standard Bridge — L1 ↔ L2
// ───────────────────────────────────────────────────────────────────────

/**
 * L1StandardBridge — used for ETH→Base and ERC20→Base deposits.
 *
 * Reference: https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/src/L1/L1StandardBridge.sol
 */
export const L1StandardBridgeABI = [
  'function depositETH(uint32 _l2GasLimit, bytes _data) external payable',
  'function depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _l2GasLimit, bytes _data) external',
  'function depositETHTo(address _to, uint32 _l2GasLimit, bytes _data) external payable',
  'function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2GasLimit, bytes _data) external',
  'event ETHDeposited(address indexed from, address indexed to, uint256 amount, bytes extraData)',
  'event ERC20Deposited(address indexed l1Token, address indexed l2Token, address indexed from, address to, uint256 amount, bytes extraData)',
] as const;

/**
 * L2StandardBridge — used for Base→ETH and ERC20 withdrawals.
 *
 * Reference: https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/src/L2/L2StandardBridge.sol
 */
export const L2StandardBridgeABI = [
  'function withdraw(address _l2Token, uint256 _amount, uint32 _l1GasLimit, bytes _data) external',
  'function withdrawTo(address _l2Token, address _to, uint256 _amount, uint32 _l1GasLimit, bytes _data) external',
  'function bridgeERC20(address _localToken, address _remoteToken, uint256 _amount, uint32 _minGasLimit, bytes _extraData) external',
  'function bridgeERC20To(address _localToken, address _remoteToken, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData) external',
  'event WithdrawalInitiated(address indexed l1Token, address indexed l2Token, address indexed from, address to, uint256 amount, bytes extraData)',
] as const;