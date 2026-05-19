/** Read model: `GET /execution/plans` item (execution-orchestrator). */
export type ExecutionPlanListItem = {
  readonly id: string;
  readonly state: string;
  readonly correlationId: string | null;
  readonly capitalReservationId: string | null;
  readonly riskDecisionId: string | null;
  readonly routeKey: string | null;
  readonly entityVersion: number;
  readonly venueType: 'dex' | 'http' | null;
  readonly chainId: number | null;
  readonly dexAdapter: string | null;
  readonly txHash: string | null;
  readonly txStatus: 'pending' | 'confirmed' | 'failed' | 'reverted' | null;
  readonly gasUsedWei: string | null;
  readonly gasCostUsd: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** Read model: `GET /execution/plans/:id/legs` item. */
export type ExecutionLegItem = {
  readonly id: string;
  readonly planId: string;
  readonly legIndex: number;
  readonly state: string;
  readonly entityVersion: number;
  readonly venueRef: string | null;
  readonly targetQuantity: number;
  readonly filledQuantity: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** Read model: `GET /execution/plans/:id/on-chain-txs` item. */
export type OnChainTxItem = {
  readonly id: number;
  readonly txHash: string;
  readonly chainId: number;
  readonly legId: string | null;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly value: string;
  readonly gasLimit: string;
  readonly gasUsed: string | null;
  readonly gasPrice: string | null;
  readonly maxPriorityFeePerGas: string | null;
  readonly maxFeePerGas: string | null;
  readonly status: 'pending' | 'confirmed' | 'failed' | 'reverted';
  readonly blockNumber: number | null;
  readonly blockHash: string | null;
  readonly transactionIndex: number | null;
  readonly confirmations: number;
  readonly confirmedAt: string | null;
  readonly revertReason: string | null;
  readonly errorMessage: string | null;
  readonly nonce: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};
