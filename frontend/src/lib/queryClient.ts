import { QueryClient } from '@tanstack/react-query'

// Default staleTime is 0 — queries are always considered stale, so NOTHING is implicitly cached.
// Data revalidates on mount / refocus / invalidation. Caching is opt-in PER ENDPOINT via an
// explicit `staleTime` on the individual useQuery call, so it is always clear what is cached:
//
//   • tree lists  ['projects'] / ['folders'] / ['documents']  -> staleTime 0  (revalidate; reflect live CRUD)
//   • document    ['document', id]                            -> staleTime 5m (cached; see useDocument)
//
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
    },
  },
})
