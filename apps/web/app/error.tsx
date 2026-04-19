'use client';

import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="operator-access-panel">
      <h1 className="operator-access-title">Operator UI error</h1>
      <div className="operator-access-body">
        <p>{error.message || 'Unexpected error while rendering operator surface.'}</p>
      </div>
      <div className="operator-access-actions">
        <Button
          type="button"
          onClick={reset}
        >
          Retry
        </Button>
      </div>
    </main>
  );
}
