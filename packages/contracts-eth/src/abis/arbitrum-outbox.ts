/**
 * Arbitrum Outbox ABI — L2 → L1 withdrawal finalization (D4-B-5-BRIDGE, L5)
 *
 * The Outbox lives on L1 (Ethereum). After an Arbitrum L2 withdrawal message is
 * included in an L2 batch that settles on L1, a relayer calls `executeTransaction`
 * on the Outbox to release funds on L1. Each executed withdrawal emits
 * `OutBoxTransactionExecuted` with a `messageNum` / `outboxEntryIndex`.
 *
 * Mainnet Outbox: 0x667e23abD27e623C11D4cc00Ca3eC4D0bd63337a
 *   (Ethereum L1 — see addresses/bridge.ts)
 *
 * Reference: https://docs.arbitrum.io/arbitrum-essentials/reference/contract-addresses
 */
export const ArbitrumOutboxABI = [
  // Execute a withdrawal message — release L1 funds after the L2 batch settles.
  'function executeTransaction(uint256 batchNum, uint64 index, address l2Sender, address to, uint256 l2TxBlockNum, uint256 l2TxBlockTimestamp, uint256 l2TxGasUsed, uint256 l2TxGasPrice, address[] proof, bytes data) external',

  // Read whether an outbox entry exists for a given batch + index (finalization check).
  'function outboxEntryExists(uint256 batchNum, uint64 index) external view returns (bool)',

  // Read the L1->L2 / L2->L1 message hash status (message-delivery check).
  'function calculateOutboxMessageHash(uint256 batchNum, uint64 index, address l2Sender, address to, uint256 l2TxBlockNum, uint256 l2TxBlockTimestamp, uint256 l2TxGasUsed, uint256 l2TxGasPrice, bytes data) external pure returns (bytes32)',

  // Emitted when an L2→L1 withdrawal is finalized (funds released on L1).
  'event OutBoxTransactionExecuted(address indexed to, address indexed l2Sender, uint256 indexed outboxEntryIndex, uint256 txHash)',

  // Inbox/Outbox aggregate — Arbitrum bridge on L1 tracks L2→L1 messages.
  'event OutboxEntryCreated(uint256 indexed batchNum, uint64 index)',

  // Reports the latest L1 batch that has been synced from L2.
  'function outboxes(address inbox) external view returns (address, uint256)',
] as const;
