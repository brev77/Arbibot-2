/**
 * OptimismPortal ABI — OP Stack L2 → L1 withdrawal finalization (D4-B-5-BRIDGE, L5)
 *
 * The OptimismPortal lives on L1. After a Base/OP L2 withdrawal is initiated on L2
 * (L2ToL1MessagePasser at 0x4200...0016), the operator must:
 *   1. PROVE the withdrawal on L1 (proveWithdrawalTransaction) → sets provenWithdrawals.
 *   2. Wait the 7-day challenge window.
 *   3. FINALIZE the withdrawal (finalizeWithdrawalTransaction) → emits WithdrawalFinalized.
 *
 * `provenWithdrawals(withdrawalHash)` returns the proof timestamp + the 7-day window
 * status. A withdrawal can only be finalized after the challenge period elapses.
 *
 * Mainnet OptimismPortal (Base): 0xbEb5Fc579115071764c7423A4fB5eD9aB6d3C91E
 *   (Ethereum L1 — see addresses/bridge.ts)
 *
 * L2ToL1MessagePasser (Base/OP L2 predeploy): 0x4200000000000000000000000000000000000016
 *
 * Reference: https://specs.optimism.io/protocol/withdrawals.html
 */
export const OptimismPortalABI = [
  // Prove a withdrawal — first step, must run before finalize.
  'function proveWithdrawalTransaction(bytes _tx, uint256 _l2OutputIndex, bytes32 _root, bytes[] _withdrawalProof) external',

  // Finalize a withdrawal — second step, only valid after the 7-day challenge window.
  'function finalizeWithdrawalTransaction(bytes _tx) external',

  // Read proof status: returns (timestamp, l2OutputIndex). timestamp==0 means not proven.
  'function provenWithdrawals(bytes32 _withdrawalHash) external view returns (uint256 timestamp, uint128 l2OutputIndex)',

  // Compute the canonical withdrawal hash for a given withdrawal-tx blob.
  'function hashWithdrawal(bytes _tx) external pure returns (bytes32)',

  // The fault-proof challenge window (seconds) that proven withdrawals must wait.
  'function proofMaturityDelaySeconds() external view returns (uint256)',

  // Emitted when a withdrawal is proven on L1.
  'event WithdrawalProven(bytes32 indexed withdrawalHash, address indexed from, address indexed to)',

  // Emitted when a withdrawal is finalized (funds released on L1). This is the
  // capital-safe "delivered" signal for OP L2→L1 withdrawals.
  'event WithdrawalFinalized(bytes32 indexed withdrawalHash, bool success)',

  // Emitted when a deposit is processed on L1 (correlated with L2 minting).
  'event TransactionDeposited(address indexed from, address indexed to, uint256 indexed version, bytes opaqueData)',
] as const;
