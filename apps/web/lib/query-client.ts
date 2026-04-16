import { QueryClient } from '@tanstack/react-query';

const defaultStaleTimeMs = 10_000;

/**
 * Single QueryClient factory for operator UI: server-state via TanStack Query
 * against same-origin `/api/operator/*` BFF (see `app/api/operator/`).
 */
export function createOperatorQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: defaultStaleTimeMs,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (failureCount >= 1) {
            return false;
          }
          return error instanceof TypeError;
        },
      },
    },
  });
}
