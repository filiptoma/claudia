import { QueryClient } from '@tanstack/react-query'

// Default staleTime is 0; caching is opt-in PER ENDPOINT via an explicit `staleTime` on the
// individual useQuery call, and kept correct by invalidation after CRUD (useTreeActions.refresh)
// and on auth change (AuthContext). What's cached:
//
//   • tree lists ['projects']/['folders']/['documents']/['members'] -> staleTime 5m (see useTree)
//   • document   ['document', id]                                   -> staleTime 5m (see useDocument)
//   • admin      ['admin','profiles']                               -> staleTime 1m (see AdminUsers)
//   • signed images ['signed-images', …]                           -> staleTime 50m (see useSignedImages)
//
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
    },
  },
})
