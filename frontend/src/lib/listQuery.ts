import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import type {
  Filter,
  ListQueryArgs,
  ListQueryResult,
  RangeValue,
  Sort,
  UseListQuery,
} from '@/components/data/types'

// The PostgREST query builder is heavily generic; we only need the chainable filter/order/range
// methods here, so we model it with a small structural type whose methods return the same shape.
// Each method returns a new builder, so callers must reassign (`q = applyFilter(q, f)`).
export type QueryBuilder = {
  ilike: (column: string, pattern: string) => QueryBuilder
  eq: (column: string, value: unknown) => QueryBuilder
  in: (column: string, values: readonly unknown[]) => QueryBuilder
  gte: (column: string, value: unknown) => QueryBuilder
  lte: (column: string, value: unknown) => QueryBuilder
  lt: (column: string, value: unknown) => QueryBuilder
  or: (conditions: string) => QueryBuilder
  order: (column: string, options: { ascending: boolean }) => QueryBuilder
  range: (from: number, to: number) => QueryBuilder
}

const isEmpty = (value: Filter['value']): boolean =>
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

// Add one calendar day to a 'YYYY-MM-DD' string (UTC), returning the same format.
const nextDay = (value: string): string => {
  const d = new Date(`${value}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Apply a single filter to the builder. Returns the (new) builder so the caller can reassign. */
export function defaultApplyFilter(q: QueryBuilder, filter: Filter): QueryBuilder {
  const { field, type, value } = filter
  if (isEmpty(value)) return q

  switch (type) {
    case 'text':
      return q.ilike(field, `%${value as string}%`)
    case 'number':
      return q.eq(field, Number(value))
    case 'select': {
      // Boolean columns arrive as the strings 'true'/'false' from the select input.
      const v = value as string
      if (v === 'true' || v === 'false') return q.eq(field, v === 'true')
      return q.eq(field, v)
    }
    case 'multiselect':
      return q.in(field, value as string[])
    case 'date': {
      const v = value as string
      return q.gte(field, v).lt(field, nextDay(v))
    }
    case 'dateRange': {
      const { from, to } = value as RangeValue
      let next = q
      if (from) next = next.gte(field, from)
      if (to) next = next.lte(field, `${to}T23:59:59.999`)
      return next
    }
    case 'datetime':
      return q.eq(field, value as string)
    case 'datetimeRange': {
      const { from, to } = value as RangeValue
      let next = q
      if (from) next = next.gte(field, from)
      if (to) next = next.lte(field, to)
      return next
    }
    default:
      return q
  }
}

export type CreateSupabaseListQueryConfig = {
  defaultSort?: Sort[]
  enabled?: boolean
  queryKey: string
  // Optionally fully override the per-filter mapping (otherwise the default mapping is used).
  applyFilter?: (q: QueryBuilder, filter: Filter) => QueryBuilder
} & (
  // Source is either a table/view (`.from(table).select(...)`) or a set-returning RPC
  // (`.rpc(name)`). The RPC path is for fail-closed SECURITY DEFINER functions (e.g.
  // `admin_projects`) that still support PostgREST filter/sort/paginate/count on their result.
  | { table: string; select?: string }
  | { rpc: string }
)

/**
 * Build a `UseListQuery<T>` hook backed by Supabase/PostgREST. Handles filtering (ilike/eq/in/range
 * by filter type), sorting (`.order`), and pagination (`.range`), and returns the exact-count total.
 * Uses react-query with `placeholderData: keepPreviousData` so paging/filtering doesn't blank out.
 */
export function createSupabaseListQuery<T>(
  config: CreateSupabaseListQueryConfig,
): UseListQuery<T> {
  const applyFilter = config.applyFilter ?? defaultApplyFilter

  // Named with a `use` prefix so it's recognised as a hook (it calls react-query's useQuery).
  return function useListQuery(args: ListQueryArgs): ListQueryResult<T> {
    const query = useQuery({
      queryKey: [config.queryKey, args],
      enabled: config.enabled ?? true,
      placeholderData: keepPreviousData,
      queryFn: async () => {
        // Build the base request from either a table/view or a set-returning RPC. Both yield a
        // PostgREST builder compatible with our structural QueryBuilder shape (filter/order/range).
        const base =
          'table' in config
            ? supabase.from(config.table).select(config.select ?? '*', { count: 'exact' })
            : supabase.rpc(config.rpc, {}, { count: 'exact' })
        let q = base as unknown as QueryBuilder

        for (const f of args.filters) {
          q = applyFilter(q, f)
        }
        for (const s of args.sort) {
          q = q.order(s.field, { ascending: s.dir === 'asc' })
        }

        const from = (args.page - 1) * args.pageSize
        q = q.range(from, from + args.pageSize - 1)

        // The builder is thenable; awaiting it executes the request and yields the PostgREST result.
        const { data, error, count } = (await (q as unknown as PromiseLike<{
          data: T[] | null
          error: { message: string } | null
          count: number | null
        }>))
        if (error) throw new Error(error.message)
        return { data: (data ?? []) as T[], count: count ?? 0 }
      },
    })

    return {
      data: query.data?.data ?? [],
      total: query.data?.count ?? 0,
      isLoading: query.isLoading,
      isError: query.isError,
      error: query.error,
      refetch: query.refetch,
    }
  }
}
