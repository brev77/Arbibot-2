'use client';

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
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: '0.6rem 0.9rem',
            background: '#1d4ed8',
            color: '#f8fafc',
            border: 0,
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    </main>
  );
}
