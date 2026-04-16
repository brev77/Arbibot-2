import type { ReactNode } from 'react';

export function OperatorAccessMessage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <main className="operator-access-panel">
      <h1 className="operator-access-title">{title}</h1>
      <div className="operator-access-body">{children}</div>
    </main>
  );
}
