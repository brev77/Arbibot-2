'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main style={{ padding: '1.5rem 2rem', maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Operator UI error</h1>
      <p style={{ color: '#94a3b8' }}>
        {error.message || 'Unexpected error while rendering operator surface.'}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          marginTop: '1rem',
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
    </main>
  );
}
