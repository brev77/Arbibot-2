import type { DataSource } from 'typeorm';

/**
 * DEX receipt mismatch detector
 * Step: DEX-1-2-RECON-ONCHAIN
 *
 * Compares on-chain transaction receipts with execution_leg states.
 * Flags mismatches when:
 *  1. An on-chain tx is confirmed/success but the linked leg is NOT filled
 *  2. An on-chain tx is failed/reverted but the linked leg IS filled
 *  3. An on-chain tx has been pending for too long (> threshold)
 */
export const MISMATCH_KIND_DEX_RECEIPT_LEG_MISMATCH =
  'dex_receipt_leg_mismatch' as const;

/**
 * Wallet balance drift detector
 * Step: DEX-1-2-RECON-ONCHAIN
 *
 * Flags wallets where the last balance update is older than a threshold,
 * indicating potential drift between on-chain and internal state.
 */
export const MISMATCH_KIND_WALLET_BALANCE_DRIFT =
  'wallet_balance_drift' as const;

/**
 * Stale on-chain transaction detector
 * Step: DEX-1-2-RECON-ONCHAIN
 *
 * Flags on-chain transactions that have been in 'pending' status
 * for longer than the configured threshold.
 */
export const MISMATCH_KIND_DEX_STALE_PENDING_TX =
  'dex_stale_pending_tx' as const;

/**
 * Run all DEX reconciliation detectors.
 * Returns the number of inserted mismatch rows per detector kind.
 */
export async function runDexDetectors(
  dataSource: DataSource,
  stalePendingHours: number = 1,
  balanceDriftHours: number = 24,
): Promise<{
  inserted: number;
  byKind: Record<string, number>;
}> {
  const byKind: Record<string, number> = {};

  const a = await runDexReceiptLegMismatchDetector(dataSource);
  byKind[MISMATCH_KIND_DEX_RECEIPT_LEG_MISMATCH] = a;

  const b = await runWalletBalanceDriftDetector(dataSource, balanceDriftHours);
  byKind[MISMATCH_KIND_WALLET_BALANCE_DRIFT] = b;

  const c = await runDexStalePendingTxDetector(dataSource, stalePendingHours);
  byKind[MISMATCH_KIND_DEX_STALE_PENDING_TX] = c;

  return { inserted: a + b + c, byKind };
}

/**
 * Detector: on-chain tx receipt status vs execution_leg state mismatch.
 *
 * Finds confirmed on-chain transactions where the linked execution leg
 * is NOT in a terminal (filled/partiallyFilled) state — OR —
 * failed/reverted on-chain transactions where the leg IS in filled state.
 */
async function runDexReceiptLegMismatchDetector(
  dataSource: DataSource,
): Promise<number> {
  const rows: unknown = await dataSource.query(
    `
    INSERT INTO reconciliation_mismatches (kind, status, details, entity_version)
    SELECT
      $1::text,
      'open',
      jsonb_build_object(
        'legId', oct.leg_id,
        'txHash', oct.tx_hash,
        'chainId', oct.chain_id,
        'txStatus', oct.status,
        'legState', el.state,
        'planId', el.plan_id
      ),
      1
    FROM on_chain_transactions oct
    JOIN execution_legs el ON el.id = oct.leg_id::uuid
    WHERE oct.leg_id IS NOT NULL
      AND oct.status IN ('confirmed', 'failed', 'reverted')
      AND (
        (oct.status = 'confirmed' AND el.state NOT IN ('filled', 'partiallyFilled'))
        OR (oct.status IN ('failed', 'reverted') AND el.state = 'filled')
      )
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_mismatches m
        WHERE m.kind = $1::text
          AND m.status = 'open'
          AND (m.details->>'legId') = oct.leg_id
      )
    LIMIT 50
    `,
    [MISMATCH_KIND_DEX_RECEIPT_LEG_MISMATCH],
  );
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Detector: wallet balance drift.
 *
 * Finds active wallets where eth_balance_updated_at is older than
 * the configured threshold — or has never been updated at all
 * while the wallet has been used (total_transactions > 0).
 */
async function runWalletBalanceDriftDetector(
  dataSource: DataSource,
  driftHours: number,
): Promise<number> {
  const rows: unknown = await dataSource.query(
    `
    INSERT INTO reconciliation_mismatches (kind, status, details, entity_version)
    SELECT
      $1::text,
      'open',
      jsonb_build_object(
        'walletAddress', ws.wallet_address,
        'chainId', ws.chain_id,
        'walletStatus', ws.status,
        'lastBalanceUpdate', COALESCE(ws.eth_balance_updated_at::text, 'never'),
        'driftThresholdHours', $2::integer
      ),
      1
    FROM wallet_states ws
    WHERE ws.status = 'active'
      AND ws.total_transactions > 0
      AND (
        ws.eth_balance_updated_at IS NULL
        OR ws.eth_balance_updated_at < NOW() - ($2::integer || ' hours')::interval
      )
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_mismatches m
        WHERE m.kind = $1::text
          AND m.status = 'open'
          AND (m.details->>'walletAddress') = ws.wallet_address
          AND (m.details->>'chainId') = ws.chain_id::text
      )
    LIMIT 50
    `,
    [MISMATCH_KIND_WALLET_BALANCE_DRIFT, driftHours],
  );
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Detector: stale pending on-chain transactions.
 *
 * Finds on-chain transactions that have been stuck in 'pending' status
 * for longer than the configured threshold.
 */
async function runDexStalePendingTxDetector(
  dataSource: DataSource,
  staleHours: number,
): Promise<number> {
  const rows: unknown = await dataSource.query(
    `
    INSERT INTO reconciliation_mismatches (kind, status, details, entity_version)
    SELECT
      $1::text,
      'open',
      jsonb_build_object(
        'txHash', oct.tx_hash,
        'chainId', oct.chain_id,
        'legId', oct.leg_id,
        'fromAddress', oct.from_address,
        'pendingSince', oct.created_at::text,
        'staleThresholdHours', $2::integer
      ),
      1
    FROM on_chain_transactions oct
    WHERE oct.status = 'pending'
      AND oct.created_at < NOW() - ($2::integer || ' hours')::interval
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_mismatches m
        WHERE m.kind = $1::text
          AND m.status = 'open'
          AND (m.details->>'txHash') = oct.tx_hash
      )
    LIMIT 50
    `,
    [MISMATCH_KIND_DEX_STALE_PENDING_TX, staleHours],
  );
  return Array.isArray(rows) ? rows.length : 0;
}