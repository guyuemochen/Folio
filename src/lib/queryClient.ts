import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client.
 *
 * Lifted out of `main.tsx` so that out-of-tree React roots (e.g. the
 * imperative `openLinkedDatabasePicker` helper, which mounts its own
 * `createRoot` on `document.body`) can wrap themselves in the same
 * `QueryClientProvider`. Without the shared client, `useQuery` calls inside
 * those detached roots throw "No QueryClient set" and the picker crashes the
 * instant it mounts — which previously made the `/linked-database` slash
 * command look like it did nothing.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30,
    },
  },
});
