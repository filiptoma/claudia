import type { RowData } from '@tanstack/react-table'

export type SortDir = 'asc' | 'desc'
export type Sort = { field: string; dir: SortDir }

export type FilterType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'dateRange'
  | 'datetime'
  | 'datetimeRange'

export type RangeValue = { from?: string; to?: string }
export type FilterValue = string | number | string[] | RangeValue | undefined
export type Filter = { field: string; type: FilterType; value: FilterValue }

export type SelectOption = { label: string; value: string }

// Per-column filter config stored in tanstack column meta.
export type ColumnFilterConfig = {
  type: FilterType
  field?: string // db field if different from column id
  options?: SelectOption[] // for select / multiselect
  placeholder?: string
}

export type PaginationState = { page: number; pageSize: number; total: number }

export type ListQueryArgs = { page: number; pageSize: number; sort: Sort[]; filters: Filter[] }

export type ListQueryResult<T> = {
  data: T[]
  total: number
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

export type UseListQuery<T> = (args: ListQueryArgs) => ListQueryResult<T>

// Carry per-column filter/sort/styling config in tanstack's column meta. The generics must mirror
// tanstack's own `ColumnMeta<TData, TValue>` signature for the augmentation to merge cleanly.
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    filter?: ColumnFilterConfig
    sortField?: string
    headClassName?: string
    cellClassName?: string
  }
}
