import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CenteredSpinner } from '@/components/ui/spinner'

import { useFilterStore, useSortStore } from './stores'
import type { Filter, PaginationState, Sort, UseListQuery } from './types'

export type ListApi<T> = {
  data: T[]
  total: number
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void }
  sort: Sort[]
  setSort: (s: Sort[]) => void
  filters: Filter[]
  setFilters: (f: Filter[]) => void
  pagination: PaginationState
  setPage: (page: number) => void
  setPageSize: (size: number) => void
}

type ListProps<T> = {
  useQuery: UseListQuery<T>
  storeKey: string
  defaultSort?: Sort[]
  initialPageSize?: number
  children: (api: ListApi<T>) => React.ReactNode
}

/**
 * Headless list orchestrator. It owns the data fetch (via the supplied `useQuery`), the persisted
 * filter/sort state (keyed by `storeKey`), and the in-memory pagination state — then hands all of it
 * to `children`. It renders NOTHING of its own except the initial loading spinner and the error
 * state; the consumer composes the Table, Pagination, etc. from the values it receives.
 */
export default function List<T>(props: ListProps<T>) {
  const { useQuery, storeKey, defaultSort, initialPageSize, children } = props

  // Persisted filter & sort state (keyed by storeKey). Pagination stays in React state.
  const { filters, setFilters } = useFilterStore(storeKey)
  const { sorts: sort, setSorts: setSort } = useSortStore(storeKey, defaultSort)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState(initialPageSize ?? 10)

  // Reset to the first page whenever the filters or sort change.
  const prevKey = useRef<string>('')
  useEffect(() => {
    const key = JSON.stringify({ filters, sort })
    if (prevKey.current && prevKey.current !== key) setPage(1)
    prevKey.current = key
  }, [filters, sort])

  const setPageSize = (size: number) => {
    setPageSizeState(size)
    setPage(1)
  }

  const { data, total, isLoading, isError, error, refetch } = useQuery({ page, pageSize, sort, filters })

  const pagination: PaginationState = { page, pageSize, total }

  // First load with no data yet → spinner. On later refetches keepPreviousData (set in the query
  // factory) keeps prior rows visible, so we keep showing children rather than blanking out.
  if (isLoading && data.length === 0) return <CenteredSpinner label="Loading…" />

  if (isError && data.length === 0) {
    const message = error instanceof Error ? error.message : 'Something went wrong while loading.'
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="size-7 text-destructive" />
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <>
      {children({
        data,
        total,
        query: { isLoading, isError, error, refetch },
        sort,
        setSort,
        filters,
        setFilters,
        pagination,
        setPage,
        setPageSize,
      })}
    </>
  )
}
