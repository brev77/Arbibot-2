# Approval Flow for Destructive Actions

## Overview

This component provides a comprehensive two-step approval flow for destructive operator actions, as specified in `DEVELOPMENT_PLAN.md` (lines 1394-1453) and Operator Safety UI Patterns.

## Component: `DestructiveOperatorAction`

Located at: `components/destructive-operator-action.tsx`

### Features

1. **Three-tier risk levels:**
   - `low`: Single-step confirmation (no preview)
   - `medium`: Single-step confirmation with impact preview
   - `high`: Two-step confirmation (preview → explicit warning → confirm)

2. **Operation status tracking:**
   - `idle` → `running` → `success` / `failure`
   - Visual feedback for each state
   - Automatic reset on cancel/success

3. **Impact preview (high/medium-risk only):**
   - Affected resources display
   - Potential consequences description
   - Mitigation strategies (optional)

4. **Accessibility:**
   - Modal overlay with backdrop blur
   - Keyboard navigation support
   - Clear visual hierarchy
   - Role="alert" for error states

### Usage Example

```typescript
<DestructiveOperatorAction
  level="high"
  actionLabel="Mark resolved"
  impactPreview={{
    affectedResources: `Incident ${m.id}`,
    potentialConsequences: 'Closing this incident will mark it as resolved...',
    mitigation: 'Ensure all underlying mismatches are properly addressed',
  }}
  onConfirm={() => mutation.mutateAsync({ id: m.id, status: 'resolved' })}
  disabled={mutation.isPending}
/>
```

## Updated Components

### `incidents-workspace.tsx`

**Changes:**
1. Import `DestructiveOperatorAction` component
2. Replace direct `Button` calls with `DestructiveOperatorAction`
3. Added proper risk levels:
   - "Investigate": `level="low"` (reversible action)
   - "Mark resolved": `level="high"` (destructive action)
4. Added impact preview for both actions
5. Changed `mutate()` to `mutateAsync()` for proper status tracking

**Benefits:**
- Prevents accidental incident resolution
- Provides clear impact preview
- Shows operation status (pending/running/success/failure)
- Integrates audit trail (backend records action)

## Operator Safety Compliance

✅ **Impact preview:** Implemented for all destructive actions
✅ **Two-step confirmation:** Implemented for high-risk actions
✅ **Single-step confirmation:** Implemented for medium/low-risk actions
✅ **Operation status tracking:** Full state machine (idle → running → success/failure)
✅ **Audit integration:** Backend records all mutations (via existing audit API)

## Future Enhancements

1. **Optimistic updates:** Update UI immediately, rollback on error
2. **Batch operations:** Support for multiple incident actions
3. **History tracking:** Show recent operator actions in modal
4. **Integration with runbooks:** Link to relevant runbook steps in impact preview

## Testing Checklist

- [ ] High-risk action shows two-step confirmation
- [ ] Medium-risk action shows one-step with preview
- [ ] Low-risk action shows simple confirmation
- [ ] Cancel button works at any stage
- [ ] Operation status updates correctly
- [ ] Error handling displays user-friendly messages
- [ ] Disabled state works correctly during operations
- [ ] Modal closes on successful completion
- [ ] Modal backdrop prevents interaction with background
