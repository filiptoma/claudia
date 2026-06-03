import { useCallback, useMemo } from 'react'
import type * as React from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type {
  ColumnDef,
  ColumnHelper,
  Row,
  RowSelectionState,
  SortingState,
  Table as TanstackTable,
  TableOptions,
  TableState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'

import { cn } from '@/lib/utils'

import {
  PlainTable,
  PlainTableBody,
  PlainTableCell,
  PlainTableHead,
  PlainTableHeader,
  PlainTableRow,
} from './PlainTable'
import TableFilterCell from './TableFilterCell'
import type { Filter, FilterValue, Sort } from './types'

const SELECTION_COLUMN_ID = '__selection__'

// `col.accessor('name', …)` etc. each return a column def typed with a concrete value (string,
// number, …); an array of mixed ones can't be annotated as `ColumnDef<T, unknown>[]` because the
// value generic is invariant. So `buildColumns` is typed to return `unknown` (callers just return
// their array) and we narrow it once here — no `any`, and the same ergonomics for callers.
type TableProps<T> = {
  data: T[]
  columns: (col: ColumnHelper<T>) => unknown
  sortControl?: { sort: Sort[]; onChange: (s: Sort[]) => void }
  filterControl?: { filters: Filter[]; onChange: (f: Filter[]) => void }
  disableSorting?: boolean
  enableSelection?: boolean
  maxSelection?: number
  selectionControl?: { selection: RowSelectionState; onChange: (s: RowSelectionState) => void }
  initialSelectionState?: RowSelectionState
  getRowId?: (row: T) => string
  onRowClick?: (row: T) => void
  noData?: React.ReactNode
}

const checkboxClass =
  'size-4 cursor-pointer rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-50'

export default function Table<T>(props: TableProps<T>) {
  const {
    data,
    columns,
    sortControl,
    filterControl,
    disableSorting = false,
    enableSelection = false,
    maxSelection,
    selectionControl,
    initialSelectionState,
    getRowId,
    onRowClick,
    noData,
  } = props

  const columnHelper = useMemo(() => createColumnHelper<T>(), [])
  const userColumns = useMemo(
    () => columns(columnHelper) as ColumnDef<T, unknown>[],
    [columns, columnHelper],
  )

  const selectedCount = useMemo(
    () =>
      selectionControl
        ? Object.values(selectionControl.selection).filter(Boolean).length
        : 0,
    [selectionControl],
  )

  // Prepend a checkbox column when selection is enabled. Header toggles all rows on the current
  // page (respecting maxSelection); each cell toggles its own row.
  const tableColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!enableSelection) return userColumns

    const isMaxReached = maxSelection != null && selectedCount >= maxSelection

    const selectionColumn = columnHelper.display({
      id: SELECTION_COLUMN_ID,
      enableSorting: false,
      header: ({ table }) => {
        const rows = table.getRowModel().rows
        const selection = table.getState().rowSelection
        const pageSelectedCount = rows.filter((r) => selection[r.id]).length
        const allSelected = rows.length > 0 && pageSelectedCount === rows.length
        const onToggle = () => {
          const next = { ...selection }
          if (allSelected) {
            for (const r of rows) delete next[r.id]
          } else if (maxSelection != null) {
            let remaining = maxSelection - selectedCount
            for (const r of rows) {
              if (remaining <= 0) break
              if (!next[r.id]) {
                next[r.id] = true
                remaining--
              }
            }
          } else {
            for (const r of rows) next[r.id] = true
          }
          selectionControl?.onChange(next)
        }
        return (
          <input
            type="checkbox"
            className={checkboxClass}
            aria-label="Select all on this page"
            checked={allSelected}
            disabled={rows.length === 0}
            onChange={onToggle}
          />
        )
      },
      cell: ({ row }) => {
        const isSelected = row.getIsSelected()
        const disabled = !isSelected && isMaxReached
        return (
          <input
            type="checkbox"
            className={checkboxClass}
            aria-label="Select row"
            checked={isSelected}
            disabled={disabled}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
          />
        )
      },
      meta: { headClassName: 'w-10', cellClassName: 'w-10' },
    })

    return [selectionColumn, ...userColumns]
  }, [enableSelection, userColumns, maxSelection, selectedCount, columnHelper, selectionControl])

  // Sorting: map our Sort[] ↔ tanstack SortingState. We keep a single active sort column.
  const isManualSorting = !disableSorting && !!sortControl

  const sorting = useMemo<SortingState>(() => {
    if (!sortControl) return []
    return sortControl.sort.map((s) => ({ id: s.field, desc: s.dir === 'desc' }))
  }, [sortControl])

  // Build a single controlled `state` object so sorting and selection can both be manual without
  // one spread clobbering the other.
  const controlledState: Partial<TableState> = {}
  if (isManualSorting) controlledState.sorting = sorting
  if (enableSelection && selectionControl) {
    controlledState.rowSelection = selectionControl.selection
  }

  const options: TableOptions<T> = {
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    defaultColumn: { size: 0, minSize: 0 },
    enableSorting: !disableSorting,
    manualSorting: isManualSorting,
    enableRowSelection: enableSelection,
    state: controlledState,
  }
  if (!disableSorting && !sortControl) options.getSortedRowModel = getSortedRowModel()
  if (enableSelection && selectionControl) {
    const control = selectionControl
    options.onRowSelectionChange = (updater) => {
      const next = typeof updater === 'function' ? updater(control.selection) : updater
      control.onChange(next)
    }
  }
  if (enableSelection && initialSelectionState) {
    options.initialState = { rowSelection: initialSelectionState }
  }
  if (getRowId) options.getRowId = (row) => getRowId(row)

  // TanStack Table intentionally returns fresh functions each render; the React Compiler can't
  // memoize them, which is fine here (this is a leaf table component).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<T>(options)

  // Click a sortable header → cycle asc → desc → none for that single field.
  const handleSort = useCallback(
    (field: string) => {
      if (!sortControl) return
      const current = sortControl.sort[0]
      if (!current || current.field !== field) {
        sortControl.onChange([{ field, dir: 'asc' }])
      } else if (current.dir === 'asc') {
        sortControl.onChange([{ field, dir: 'desc' }])
      } else {
        sortControl.onChange([])
      }
    },
    [sortControl],
  )

  const leafColumns = table.getAllLeafColumns()
  const hasFilters = !!filterControl && leafColumns.some((c) => c.columnDef.meta?.filter)

  const findFilter = useCallback(
    (field: string): FilterValue =>
      filterControl?.filters.find((f) => f.field === field)?.value,
    [filterControl],
  )

  const updateFilter = useCallback(
    (field: string, type: Filter['type'], value: FilterValue) => {
      if (!filterControl) return
      const rest = filterControl.filters.filter((f) => f.field !== field)
      const isEmpty =
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      filterControl.onChange(isEmpty ? rest : [...rest, { field, type, value }])
    },
    [filterControl],
  )

  const headerGroup = table.getHeaderGroups()[0]
  const rows = table.getRowModel().rows
  const columnCount = leafColumns.length

  return (
    <PlainTable>
      <PlainTableHeader>
        {/* Title row (sort) */}
        <PlainTableRow className="even:bg-muted hover:bg-muted">
          {headerGroup.headers.map((header) => {
            const column = header.column
            const sortField = column.columnDef.meta?.sortField ?? column.id
            const canSort = !disableSorting && column.getCanSort()
            const active = sortControl?.sort.find((s) => s.field === sortField)
            const sortable = canSort && !!sortControl
            return (
              <PlainTableHead
                key={header.id}
                className={cn(sortable && 'cursor-pointer select-none', column.columnDef.meta?.headClassName)}
                onClick={sortable ? () => handleSort(sortField) : undefined}
              >
                {header.isPlaceholder ? null : (
                  <span className="flex items-center gap-1.5">
                    {flexRender(column.columnDef.header, header.getContext())}
                    {sortable &&
                      (active?.dir === 'asc' ? (
                        <ArrowUp className="size-3.5" />
                      ) : active?.dir === 'desc' ? (
                        <ArrowDown className="size-3.5" />
                      ) : (
                        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                      ))}
                  </span>
                )}
              </PlainTableHead>
            )
          })}
        </PlainTableRow>

        {/* Filter row */}
        {hasFilters && (
          <PlainTableRow className="even:bg-muted hover:bg-muted">
            {headerGroup.headers.map((header) => {
              const filterConfig = header.column.columnDef.meta?.filter
              if (!filterConfig) {
                return <PlainTableHead key={header.id} className="py-1.5" />
              }
              const field = filterConfig.field ?? header.column.id
              return (
                <PlainTableHead key={header.id} className="py-1.5 font-normal normal-case">
                  <TableFilterCell
                    config={filterConfig}
                    value={findFilter(field)}
                    onChange={(v) => updateFilter(field, filterConfig.type, v)}
                  />
                </PlainTableHead>
              )
            })}
          </PlainTableRow>
        )}
      </PlainTableHeader>

      <PlainTableBody>
        {rows.length === 0 ? (
          <PlainTableRow className="hover:bg-transparent">
            <PlainTableCell
              colSpan={columnCount}
              className="py-10 text-center text-muted-foreground"
            >
              {noData ?? 'No data'}
            </PlainTableCell>
          </PlainTableRow>
        ) : (
          rows.map((row: Row<T>) => (
            <PlainTableRow
              key={row.id}
              className={cn(onRowClick && 'cursor-pointer')}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <PlainTableCell key={cell.id} className={cell.column.columnDef.meta?.cellClassName}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </PlainTableCell>
              ))}
            </PlainTableRow>
          ))
        )}
      </PlainTableBody>
    </PlainTable>
  )
}

// Re-exported so callers can type their selection state without importing tanstack directly.
export type { RowSelectionState, TanstackTable }
