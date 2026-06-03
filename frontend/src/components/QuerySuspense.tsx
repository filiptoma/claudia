import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CenteredSpinner } from '@/components/ui/spinner'

// Minimal shape we need from a TanStack `useQuery` result (so callers can pass query results
// directly, or hand-rolled aggregates).
export interface QueryLike {
  isPending?: boolean
  isLoading?: boolean
  isError: boolean
  error?: unknown
  refetch?: () => unknown
}

const isPendingState = (q: QueryLike) => q.isPending ?? q.isLoading ?? false

/**
 * Gate a section of UI on one OR MORE queries:
 *   - any query errored        → error UI (with retry for all)
 *   - else any query pending    → centered spinner
 *   - else                      → children
 *
 * Group only queries whose success the section truly depends on. Two unrelated sections that each
 * make their own API calls should use TWO QuerySuspense boundaries, so one failing/loading does
 * not blank out the other.
 */
export default function QuerySuspense({
  queries,
  children,
  loadingLabel,
  className,
}: {
  queries: QueryLike | QueryLike[]
  children: ReactNode
  loadingLabel?: string
  className?: string
}) {
  const list = Array.isArray(queries) ? queries : [queries]
  const errored = list.filter((q) => q.isError)
  const pending = list.some(isPendingState)

  if (errored.length > 0) {
    const message =
      errored.map((q) => (q.error instanceof Error ? q.error.message : null)).find(Boolean) ??
      'Something went wrong while loading.'
    return (
      <div className={`flex h-full min-h-40 w-full flex-1 flex-col items-center justify-center gap-3 p-8 text-center ${className ?? ''}`}>
        <AlertCircle className="size-7 text-destructive" />
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
        {list.some((q) => q.refetch) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => list.forEach((q) => q.refetch?.())}
          >
            Try again
          </Button>
        )}
      </div>
    )
  }

  if (pending) return <CenteredSpinner className={className} label={loadingLabel} />

  return <>{children}</>
}
