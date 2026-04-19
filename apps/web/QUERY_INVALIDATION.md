# Query Invalidation Strategy

## Overview

This document defines the query invalidation strategy for Arbibot 2 operator dashboard, ensuring data consistency and optimal user experience.

## Core Principles

1. **Explicit invalidation over stale time** — invalidate queries immediately after mutations
2. **Granular invalidation** — invalidate only affected queries, not everything
3. **Predictable cache** — use consistent `staleTime` per query type
4. **User control** — manual refresh buttons on all read-only lists

## Query Mapping

### Dashboard

```typescript
// lib/operator-query-keys.ts
operatorKeys.dashboardSummary

// Invalidation triggers
- After incident status mutations (resolved/investigating)
- After portfolio position changes
- Manual refresh button click
```

**Query:** `GET /api/operator/dashboard/summary`

**Stale time:** 30s (per-component override for freshness)

**Invalidation:** 
- Component-level: `summary.refetch()`
- After mutations: `queryClient.invalidateQueries({ queryKey: operatorKeys.dashboardSummary })`

---

### Incidents

```typescript
// lib/operator-query-keys.ts
operatorKeys.reconciliationMismatches

// Invalidation triggers
- After PATCH /reconciliation/mismatches/:id (status change)
- After POST /reconciliation/mismatches/run-detectors
- Manual refresh button click
```

**Query:** `GET /api/operator/reconciliation/mismatches`

**Stale time:** 10s (default)

**Invalidation:**
```typescript
// After status mutation
await queryClient.invalidateQueries({
  queryKey: operatorKeys.reconciliationMismatches,
});

// After run detectors
await queryClient.invalidateQueries({
  queryKey: operatorKeys.reconciliationMismatches,
});
```

---

### Opportunities

```typescript
// lib/operator-query-keys.ts
operatorKeys.opportunities

// Invalidation triggers
- Future: POST /opportunities (create opportunity)
- Future: PATCH /opportunities/:id (update opportunity)
- Manual refresh button click
```

**Query:** `GET /api/operator/opportunities`

**Stale time:** 10s (default)

**Invalidation:**
```typescript
await queryClient.invalidateQueries({
  queryKey: operatorKeys.opportunities,
});
```

---

### Execution Plans

```typescript
// lib/operator-query-keys.ts
operatorKeys.executionPlans
operatorKeys.executionPlan(id)

// Invalidation triggers
- Future: POST /execution/plans (create plan)
- Future: PATCH /execution/plans/:id (update plan)
- Manual refresh button click
```

**Query:** `GET /api/operator/execution/plans`, `GET /api/operator/execution/plans/:id`

**Stale time:** 10s (default)

**Invalidation:**
```typescript
// Invalidate list
await queryClient.invalidateQueries({
  queryKey: operatorKeys.executionPlans,
});

// Invalidate single plan (more granular)
await queryClient.invalidateQueries({
  queryKey: operatorKeys.executionPlan(planId),
});
```

---

### Portfolio

```typescript
// lib/operator-query-keys.ts
operatorKeys.portfolioPositions

// Invalidation triggers
- Future: POST /positions/confirm-fill (new position)
- Future: PATCH /positions/:id (update position)
- Manual refresh button click
```

**Query:** `GET /api/operator/portfolio/positions`

**Stale time:** 10s (default)

**Invalidation:**
```typescript
await queryClient.invalidateQueries({
  queryKey: operatorKeys.portfolioPositions,
});
```

---

### Paper Trades

```typescript
// lib/operator-query-keys.ts
operatorKeys.paperTrades

// Invalidation triggers
- Future: POST /paper/trades (create trade)
- Future: PATCH /paper/trades/:id (update trade)
- Manual refresh button click
```

**Query:** `GET /api/operator/paper/trades`

**Stale time:** 10s (default)

**Invalidation:**
```typescript
await queryClient.invalidateQueries({
  queryKey: operatorKeys.paperTrades,
});
```

---

### Paper Promotion Candidates

```typescript
// lib/operator-query-keys.ts
operatorKeys.paperPromotionCandidates

// Invalidation triggers
- After POST /opportunities/:id/paper-enqueue (creates candidate)
- Future: PATCH /paper/promotion-candidates/:id (approve/reject)
- Manual refresh button click
```

**Query:** `GET /api/operator/paper/promotion-candidates`

**Stale time:** 10s (default)

**Invalidation:**
```typescript
await queryClient.invalidateQueries({
  queryKey: operatorKeys.paperPromotionCandidates,
});
```

---

### Paper Drift Samples

```typescript
// lib/operator-query-keys.ts
operatorKeys.paperDriftSamples(instrumentKey, limit)

// Invalidation triggers
- After new drift sample recorded (automatic backend push)
- Manual refresh button click
```

**Query:** `GET /api/operator/paper/drift-samples?limit=30`

**Stale time:** 10s (default)

**Invalidation:**
```typescript
await queryClient.invalidateQueries({
  queryKey: operatorKeys.paperDriftSamples(undefined, 30),
});
```

---

### Audit

```typescript
// lib/operator-query-keys.ts
operatorKeys.auditEntries(limit)

// Invalidation triggers
- After any mutation (backend creates audit entry)
- Manual refresh button click
```

**Query:** `GET /api/operator/audit/entries?limit=12`

**Stale time:** 10s (default)

**Invalidation:**
```typescript
await queryClient.invalidateQueries({
  queryKey: operatorKeys.auditEntries(12),
});
```

---

## Global Query Client Defaults

```typescript
// lib/query-client.ts
export function createOperatorQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,          // 10s default freshness
        gcTime: 5 * 60 * 1000,     // 5min garbage collection
        refetchOnWindowFocus: false,   // Manual control only
        retry: (failureCount, error) => {
          if (failureCount >= 1) {
            return false;  // Fail fast, let user retry
          }
          return error instanceof TypeError;  // Retry network errors only
        },
      },
    },
  });
}
```

**Policy:**
- **No automatic refetch on window focus** — prevents unnecessary load
- **Single retry on network errors** — fail fast for validation/permission errors
- **5min garbage collection** — balance memory vs cache performance
- **Component-specific staleTime overrides** — dashboard summary 30s, others default 10s

---

## Invalidation Patterns

### Pattern 1: After mutation with success

```typescript
const mutation = useMutation({
  mutationFn: (args) => fetchOperatorBffJson('/resource', {
    method: 'POST',
    body: args,
  }),
  onSuccess: async () => {
    await queryClient.invalidateQueries({
      queryKey: operatorKeys.resourceKey,
    });
  },
});
```

### Pattern 2: Optimistic updates with rollback

```typescript
const mutation = useMutation({
  mutationFn: (args) => fetchOperatorBffJson('/resource', {
    method: 'PATCH',
    body: args,
  }),
  onMutate: async (newData) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries({ queryKey: operatorKeys.resourceKey });

    // Snapshot previous value
    const previous = queryClient.getQueryData(operatorKeys.resourceKey);

    // Optimistically update
    queryClient.setQueryData(operatorKeys.resourceKey, newData);

    return { previous };
  },
  onError: (err, newData, context) => {
    // Rollback on error
    if (context?.previous) {
      queryClient.setQueryData(operatorKeys.resourceKey, context.previous);
    }
  },
  onSettled: async () => {
    // Always refetch after mutation settles
    await queryClient.invalidateQueries({
      queryKey: operatorKeys.resourceKey,
    });
  },
});
```

### Pattern 3: Manual refresh with button state

```typescript
const query = useQuery({
  queryKey: operatorKeys.resourceKey,
  queryFn: () => fetchOperatorBffJson('/resource'),
});

<Button
  type="button"
  variant="secondary"
  size="sm"
  onClick={() => void query.refetch()}
  disabled={query.isFetching}
>
  {query.isFetching ? 'Refreshing…' : 'Refresh'}
</Button>
```

---

## Future Enhancements

1. **Real-time updates via SSE/WebSocket** — replace polling for `/execution`, `/incidents`
2. **Invalidate related queries** — e.g., invalidate portfolio when position created
3. **Prefetch on hover** — prefetch opportunity detail when hovering over list item
4. **Query deduplication** — ensure same query isn't fetched multiple times
5. **Error boundary per query** — prevent cascading failures from single query errors

---

## Testing Checklist

- [ ] Manual refresh buttons work on all pages
- [ ] Queries invalidate after successful mutations
- [ ] Stale time overrides applied correctly (dashboard 30s, others 10s)
- [ ] No unnecessary refetches on window focus
- [ ] Cache garbage collection works (5min gcTime)
- [ ] Optimistic updates roll back correctly on error
- [ ] Related queries invalidate when needed
