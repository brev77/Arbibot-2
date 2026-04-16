'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { createOperatorQueryClient } from '@/lib/query-client';

export function Providers({ children }: { children: ReactNode }): ReactNode {
  const [client] = useState(() => createOperatorQueryClient());

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
