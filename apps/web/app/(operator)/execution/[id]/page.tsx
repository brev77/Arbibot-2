import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { apiBases } from '../../../../lib/api-base';
import type { AuditListItem } from '../../../../lib/audit-types';
import {
  formatGasEth,
  getAdapterDisplayName,
  getChainMeta,
  getExplorerTxUrl,
  getTxStatusBadge,
  getVenueBadge,
  truncateHash,
} from '../../../../lib/dex-utils';
import { DexOperatorActions } from '../../../../components/dex-operator-actions';
import { buildExecutionPlanTimeline } from '../../../../lib/execution-timeline';
import type { ExecutionLegItem, ExecutionPlanListItem, OnChainTxItem } from '../../../../lib/execution-types';
import { fetchJson, fetchResource, type ListResponse } from '../../../../lib/server-api';

/* ─── Shared badge component ─────────────────────────────────────────────── */

function Badge({
  label,
  bg,
  text,
}: {
  readonly label: string;
  readonly bg: string;
  readonly text: string;
}): ReactNode {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '18px',
        background: bg,
        color: text,
      }}
    >
      {label}
    </span>
  );
}

/* ─── On-chain tx detail card ─────────────────────────────────────────────── */

function OnChainTxCard({ tx }: { readonly tx: OnChainTxItem }): ReactNode {
  const chainMeta = getChainMeta(tx.chainId);
  const txUrl = getExplorerTxUrl(tx.chainId, tx.txHash);
  const blockUrl =
    tx.blockNumber !== null && chainMeta !== null
      ? `${chainMeta.explorerTxUrl.replace('/tx/', '/block/')}${tx.blockNumber}`
      : '';
  const statusBadge = getTxStatusBadge(tx.status);

  const gasUsedPct =
    tx.gasUsed !== null && tx.gasLimit !== null
      ? ((Number(tx.gasUsed) / Number(tx.gasLimit)) * 100).toFixed(1)
      : null;

  const gasPriceGwei =
    tx.gasPrice !== null ? (Number(tx.gasPrice) / 1e9).toFixed(2) : null;

  return (
    <div
      style={{
        marginTop: '0.75rem',
        padding: '0.75rem 1rem',
        borderRadius: 6,
        border: '1px solid #334155',
        background: '#0f172a',
      }}
    >
      <h4 style={{ margin: '0 0 0.5rem', fontSize: 13, color: '#e2e8f0' }}>
        On-chain Transaction
      </h4>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: '150px 1fr',
          gap: '0.25rem 1rem',
          fontSize: 12,
        }}
      >
        <dt style={{ color: '#64748b' }}>Tx Hash</dt>
        <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <code>{truncateHash(tx.txHash, 10, 6)}</code>
          {txUrl.length > 0 && (
            <a
              href={txUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#38bdf8', fontSize: 11 }}
            >
              Explorer ↗
            </a>
          )}
        </dd>

        <dt style={{ color: '#64748b' }}>Status</dt>
        <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Badge label={statusBadge.label} bg={statusBadge.bg} text={statusBadge.text} />
          {tx.status === 'confirmed' && tx.confirmations > 0 && (
            <span style={{ color: '#6ee7b7', fontSize: 11 }}>
              ({tx.confirmations} confirmations)
            </span>
          )}
        </dd>

        <dt style={{ color: '#64748b' }}>Chain</dt>
        <dd style={{ margin: 0 }}>
          {chainMeta !== null ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: chainMeta.color,
                }}
              />
              {chainMeta.name} ({tx.chainId})
            </span>
          ) : (
            tx.chainId
          )}
        </dd>

        {tx.blockNumber !== null && (
          <>
            <dt style={{ color: '#64748b' }}>Block</dt>
            <dd style={{ margin: 0 }}>
              #{tx.blockNumber.toLocaleString()}
              {blockUrl.length > 0 && (
                <a
                  href={blockUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginLeft: 8, color: '#38bdf8', fontSize: 11 }}
                >
                  Explorer ↗
                </a>
              )}
            </dd>
          </>
        )}

        <dt style={{ color: '#64748b' }}>From</dt>
        <dd style={{ margin: 0 }}>
          <code style={{ fontSize: 11 }}>{truncateHash(tx.fromAddress)}</code>
        </dd>

        <dt style={{ color: '#64748b' }}>To</dt>
        <dd style={{ margin: 0 }}>
          <code style={{ fontSize: 11 }}>{truncateHash(tx.toAddress)}</code>
        </dd>

        {tx.nonce !== null && (
          <>
            <dt style={{ color: '#64748b' }}>Nonce</dt>
            <dd style={{ margin: 0 }}>{tx.nonce}</dd>
          </>
        )}

        <dt style={{ color: '#64748b' }}>Gas Limit</dt>
        <dd style={{ margin: 0 }}>{Number(tx.gasLimit).toLocaleString()}</dd>

        {tx.gasUsed !== null && (
          <>
            <dt style={{ color: '#64748b' }}>Gas Used</dt>
            <dd style={{ margin: 0 }}>
              {Number(tx.gasUsed).toLocaleString()}
              {gasUsedPct !== null && (
                <span style={{ color: '#94a3b8', marginLeft: 4 }}>({gasUsedPct}%)</span>
              )}
            </dd>
          </>
        )}

        {gasPriceGwei !== null && (
          <>
            <dt style={{ color: '#64748b' }}>Gas Price</dt>
            <dd style={{ margin: 0 }}>{gasPriceGwei} Gwei</dd>
          </>
        )}

        {tx.maxFeePerGas !== null && (
          <>
            <dt style={{ color: '#64748b' }}>Max Fee</dt>
            <dd style={{ margin: 0 }}>{(Number(tx.maxFeePerGas) / 1e9).toFixed(2)} Gwei</dd>
          </>
        )}

        {tx.maxPriorityFeePerGas !== null && (
          <>
            <dt style={{ color: '#64748b' }}>Priority Fee</dt>
            <dd style={{ margin: 0 }}>
              {(Number(tx.maxPriorityFeePerGas) / 1e9).toFixed(2)} Gwei
            </dd>
          </>
        )}

        <dt style={{ color: '#64748b' }}>Value</dt>
        <dd style={{ margin: 0 }}>{formatGasEth(tx.value)}</dd>

        <dt style={{ color: '#64748b' }}>Submitted</dt>
        <dd style={{ margin: 0 }}>{tx.createdAt}</dd>

        {tx.confirmedAt !== null && (
          <>
            <dt style={{ color: '#64748b' }}>Confirmed</dt>
            <dd style={{ margin: 0 }}>{tx.confirmedAt}</dd>
          </>
        )}

        {tx.revertReason !== null && (
          <>
            <dt style={{ color: '#fca5a5' }}>Revert Reason</dt>
            <dd style={{ margin: 0, color: '#fca5a5' }}>{tx.revertReason}</dd>
          </>
        )}

        {tx.errorMessage !== null && (
          <>
            <dt style={{ color: '#fca5a5' }}>Error</dt>
            <dd style={{ margin: 0, color: '#fca5a5' }}>{tx.errorMessage}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/* ─── Leg status badge color ──────────────────────────────────────────────── */

function getLegStateBadge(state: string): { label: string; bg: string; text: string } {
  switch (state) {
    case 'filled':
      return { label: 'Filled', bg: '#064e3b', text: '#6ee7b7' };
    case 'sent':
      return { label: 'Sent', bg: '#1e3a5f', text: '#93c5fd' };
    case 'acknowledged':
      return { label: 'Ack', bg: '#1e3a5f', text: '#93c5fd' };
    case 'partiallyFilled':
      return { label: 'Partial', bg: '#713f12', text: '#fcd34d' };
    case 'rejected':
      return { label: 'Rejected', bg: '#7f1d1d', text: '#fca5a5' };
    case 'failed':
      return { label: 'Failed', bg: '#7f1d1d', text: '#fca5a5' };
    case 'timedOut':
      return { label: 'Timeout', bg: '#7c2d12', text: '#fdba74' };
    case 'canceled':
      return { label: 'Canceled', bg: '#334155', text: '#94a3b8' };
    case 'created':
    default:
      return { label: state, bg: '#1e293b', text: '#94a3b8' };
  }
}

/* ─── Main page component ─────────────────────────────────────────────────── */

export default async function ExecutionPlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const result = await fetchResource<ExecutionPlanListItem>(
    `${apiBases.execution}/execution/plans/${id}`,
    10,
  );
  if (!result.ok) {
    if (result.kind === 'not_found') {
      notFound();
    }
    const detail =
      result.kind === 'upstream'
        ? `Execution API returned HTTP ${result.status}`
        : 'Could not reach execution orchestrator';
    throw new Error(detail);
  }
  const plan = result.data;

  // Fetch legs, on-chain txs, and audit in parallel
  const [legsBody, onChainTxsBody, auditBody] = await Promise.all([
    fetchJson<ListResponse<ExecutionLegItem>>(
      `${apiBases.execution}/execution/plans/${id}/legs`,
      10,
    ),
    fetchJson<ListResponse<OnChainTxItem>>(
      `${apiBases.execution}/execution/plans/${id}/on-chain-txs`,
      10,
    ),
    fetchJson<ListResponse<AuditListItem>>(
      `${apiBases.audit}/audit/entries?limit=200`,
      10,
    ),
  ]);

  const legs = legsBody?.items ?? [];
  const onChainTxs = onChainTxsBody?.items ?? [];
  const auditItems = auditBody?.items ?? [];
  const timeline = buildExecutionPlanTimeline(plan, auditItems);

  // Group on-chain txs by legId
  const txsByLeg = new Map<string, OnChainTxItem[]>();
  for (const tx of onChainTxs) {
    const legId = tx.legId ?? '__no_leg__';
    const arr = txsByLeg.get(legId) ?? [];
    arr.push(tx);
    txsByLeg.set(legId, arr);
  }

  // DEX enrichment
  const isDex = plan.venueType === 'dex';
  const chainMeta = getChainMeta(plan.chainId);
  const venueBadge = getVenueBadge(plan.venueType);
  const txBadge = getTxStatusBadge(plan.txStatus);
  const txExplorerUrl =
    plan.txHash !== null ? getExplorerTxUrl(plan.chainId, plan.txHash) : '';

  return (
    <main style={{ padding: '1.5rem 2rem', maxWidth: 1100 }}>
      <p style={{ marginTop: 0 }}>
        <Link href="/execution" style={{ color: '#38bdf8', fontSize: 14 }}>
          ← Execution plans
        </Link>
      </p>
      <h1 style={{ marginTop: '0.25rem' }}>Execution plan</h1>
      <p style={{ color: '#94a3b8', fontSize: 14 }}>
        Read-only detail with legs and on-chain transaction data.
      </p>

      {/* ─── Plan Header ─────────────────────────────────────────────────── */}
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: '180px 1fr',
          gap: '0.35rem 1rem',
          fontSize: 14,
          marginTop: '1.5rem',
        }}
      >
        <dt style={{ color: '#64748b' }}>ID</dt>
        <dd style={{ margin: 0, wordBreak: 'break-all', fontFamily: 'monospace' }}>{plan.id}</dd>
        <dt style={{ color: '#64748b' }}>State</dt>
        <dd style={{ margin: 0 }}>
          <Badge
            label={plan.state}
            bg={plan.state === 'completed' ? '#064e3b' : plan.state === 'failed' ? '#7f1d1d' : '#1e3a5f'}
            text={plan.state === 'completed' ? '#6ee7b7' : plan.state === 'failed' ? '#fca5a5' : '#93c5fd'}
          />
        </dd>
        <dt style={{ color: '#64748b' }}>Venue</dt>
        <dd style={{ margin: 0 }}>
          <Badge label={venueBadge.label} bg={venueBadge.bg} text={venueBadge.text} />
        </dd>
        {isDex && chainMeta !== null && (
          <>
            <dt style={{ color: '#64748b' }}>Chain</dt>
            <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: chainMeta.color,
                }}
              />
              {chainMeta.name} ({plan.chainId})
            </dd>
          </>
        )}
        {plan.dexAdapter !== null && (
          <>
            <dt style={{ color: '#64748b' }}>Adapter</dt>
            <dd style={{ margin: 0 }}>{getAdapterDisplayName(plan.dexAdapter)}</dd>
          </>
        )}
        <dt style={{ color: '#64748b' }}>Correlation</dt>
        <dd style={{ margin: 0, fontFamily: 'monospace' }}>{plan.correlationId ?? '—'}</dd>
        <dt style={{ color: '#64748b' }}>Capital reservation</dt>
        <dd style={{ margin: 0 }}>{plan.capitalReservationId ?? '—'}</dd>
        <dt style={{ color: '#64748b' }}>Risk decision</dt>
        <dd style={{ margin: 0 }}>{plan.riskDecisionId ?? '—'}</dd>
        <dt style={{ color: '#64748b' }}>Route key</dt>
        <dd style={{ margin: 0 }}>{plan.routeKey ?? '—'}</dd>
        <dt style={{ color: '#64748b' }}>Version</dt>
        <dd style={{ margin: 0 }}>{plan.entityVersion}</dd>
        <dt style={{ color: '#64748b' }}>Created</dt>
        <dd style={{ margin: 0 }}>{plan.createdAt}</dd>
        <dt style={{ color: '#64748b' }}>Updated</dt>
        <dd style={{ margin: 0 }}>{plan.updatedAt}</dd>
      </dl>

      {/* ─── DEX Summary Section ─────────────────────────────────────────── */}
      {isDex && (
        <section
          style={{
            marginTop: '2rem',
            padding: '1rem 1.25rem',
            borderRadius: 8,
            border: '1px solid #581c87',
            background: 'rgba(88, 28, 135, 0.08)',
          }}
        >
          <h2 style={{ fontSize: '1.05rem', marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            On-chain Summary
          </h2>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 1fr',
              gap: '0.3rem 1rem',
              fontSize: 13,
            }}
          >
            <dt style={{ color: '#64748b' }}>Tx status</dt>
            <dd style={{ margin: 0 }}>
              <Badge label={txBadge.label} bg={txBadge.bg} text={txBadge.text} />
            </dd>
            <dt style={{ color: '#64748b' }}>Tx hash</dt>
            <dd style={{ margin: 0 }}>
              {plan.txHash !== null ? (
                <>
                  <code style={{ fontSize: 12 }}>{truncateHash(plan.txHash, 10, 6)}</code>
                  {txExplorerUrl.length > 0 && (
                    <a
                      href={txExplorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginLeft: 8, color: '#38bdf8', fontSize: 12 }}
                    >
                      Explorer ↗
                    </a>
                  )}
                </>
              ) : (
                '—'
              )}
            </dd>
            <dt style={{ color: '#64748b' }}>Total gas</dt>
            <dd style={{ margin: 0 }}>
              {formatGasEth(plan.gasUsedWei)}
              {plan.gasCostUsd !== null && (
                <span style={{ color: '#94a3b8', marginLeft: 8 }}>
                  (${plan.gasCostUsd})
                </span>
              )}
            </dd>
          </dl>
        </section>
      )}

      {/* ─── Execution Legs Table ─────────────────────────────────────────── */}
      <section style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>Execution Legs ({legs.length})</h2>
        {legs.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>
            No legs created for this plan yet.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: '0.75rem' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Leg #</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Venue ref</th>
                  <th style={thStyle}>Target qty</th>
                  <th style={thStyle}>Filled qty</th>
                  <th style={thStyle}>Version</th>
                  <th style={thStyle}>Created</th>
                </tr>
              </thead>
              <tbody>
                {legs.map((leg) => {
                  const legStateBadge = getLegStateBadge(leg.state);
                  return (
                    <tr key={leg.id} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={tdStyle}>
                        <strong>{leg.legIndex}</strong>
                      </td>
                      <td style={tdStyle}>
                        <Badge label={legStateBadge.label} bg={legStateBadge.bg} text={legStateBadge.text} />
                      </td>
                      <td style={tdStyle}>
                        {leg.venueRef !== null ? (
                          <code style={{ fontSize: 11 }}>{truncateHash(leg.venueRef)}</code>
                        ) : (
                          <span style={{ color: '#64748b' }}>—</span>
                        )}
                      </td>
                      <td style={tdStyle}>{leg.targetQuantity}</td>
                      <td style={tdStyle}>{leg.filledQuantity}</td>
                      <td style={tdStyle}>{leg.entityVersion}</td>
                      <td style={tdStyle}>{new Date(leg.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── On-chain Transactions ────────────────────────────────────────── */}
      {onChainTxs.length > 0 && (
        <section style={{ marginTop: '2.5rem' }}>
          <h2 style={{ fontSize: '1.05rem' }}>
            On-chain Transactions ({onChainTxs.length})
          </h2>
          {onChainTxs.map((tx) => (
            <OnChainTxCard key={tx.id} tx={tx} />
          ))}
        </section>
      )}

      {/* ─── Timeline ─────────────────────────────────────────────────────── */}
      <section style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>Timeline</h2>
        {auditBody === null ? (
          <p style={{ color: '#94a3b8' }}>
            Audit service unavailable — timeline needs{' '}
            <code>GET /audit/entries</code>.
          </p>
        ) : timeline.length === 0 ? (
          <p style={{ color: '#94a3b8' }}>
            No audit rows matched this plan in the recent window.
          </p>
        ) : (
          <ol
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '1rem 0 0',
              borderLeft: '2px solid #334155',
            }}
          >
            {timeline.map((e) => (
              <li
                key={e.id}
                style={{
                  position: 'relative',
                  padding: '0.5rem 0 0.5rem 1.25rem',
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: -5,
                    top: '0.65rem',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#38bdf8',
                  }}
                />
                <div style={{ color: '#e2e8f0' }}>
                  <strong>{e.action}</strong>{' '}
                  <span style={{ color: '#64748b' }}>{e.actor}</span>
                </div>
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  {e.createdAt}
                  {e.resourceType !== null ? ` · ${e.resourceType}` : ''}
                  {e.correlationId !== null ? ` · corr ${e.correlationId.slice(0, 8)}…` : ''}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ─── Operator Actions ─────────────────────────────────────────────── */}
      <section
        style={{
          marginTop: '2.5rem',
          padding: '1rem 1.25rem',
          borderRadius: 8,
          border: '1px dashed #475569',
          background: '#0f172a',
        }}
      >
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>Operator actions</h2>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: '1rem' }}>
          Destructive controls require impact preview, two-step approval, and audit (§5.4).
          Force hedge/unwind require full impact preview — still backlog.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button type="button" disabled>
            Force hedge (preview)
          </button>
          <button type="button" disabled>
            Force unwind (preview)
          </button>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <DexOperatorActions
            planId={plan.id}
            legs={legs}
            isDex={isDex}
          />
        </div>
      </section>
    </main>
  );
}

/* ─── Table cell styles ──────────────────────────────────────────────────── */

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.5rem',
  borderBottom: '1px solid #334155',
  color: '#94a3b8',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  fontSize: 12,
};

const tdStyle: React.CSSProperties = {
  padding: '0.45rem 0.5rem',
  borderBottom: '1px solid #1e293b',
  verticalAlign: 'top',
  fontSize: 13,
};