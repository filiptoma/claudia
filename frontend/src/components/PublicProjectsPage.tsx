import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, SearchX, X } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { createSupabaseListQuery, defaultApplyFilter } from '../lib/listQuery'
import { List, Pagination } from './data'
import type { Filter, ListApi, RangeValue } from './data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import EmptyState from './EmptyState'
import PublicProjectCard from './PublicProjectCard'
import PageLayout from './PageLayout'
import PageHeader from './PageHeader'
import type { PublicProject } from '../lib/types'
import { APP_NAME } from '../lib/brand'

const usePublicProjectsQuery = createSupabaseListQuery<PublicProject>({
  rpc: 'list_public_projects',
  queryKey: 'public-projects',
  defaultSort: [{ field: 'updated_at', dir: 'desc' }],
  applyFilter: (q, filter) => {
    if (filter.field === 'name' && filter.type === 'text' && filter.value) {
      const v = filter.value as string
      return q.or(`name.ilike.%${v}%,slug.ilike.%${v}%`)
    }
    return defaultApplyFilter(q, filter)
  },
})

interface FilterState {
  search: string
  owner: string
  updatedFrom: string
  updatedTo: string
  createdFrom: string
  createdTo: string
}


function toFilterList(f: FilterState): Filter[] {
  const out: Filter[] = []
  if (f.search) out.push({ field: 'name', type: 'text', value: f.search })
  if (f.owner) out.push({ field: 'owner_name', type: 'text', value: f.owner })
  if (f.updatedFrom || f.updatedTo) {
    const rv: RangeValue = {}
    if (f.updatedFrom) rv.from = f.updatedFrom
    if (f.updatedTo) rv.to = f.updatedTo
    out.push({ field: 'updated_at', type: 'dateRange', value: rv })
  }
  if (f.createdFrom || f.createdTo) {
    const rv: RangeValue = {}
    if (f.createdFrom) rv.from = f.createdFrom
    if (f.createdTo) rv.to = f.createdTo
    out.push({ field: 'created_at', type: 'dateRange', value: rv })
  }
  return out
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

// ---- Text input with inline clear button ----

function FilterInput({
  value,
  onChange,
  placeholder,
  icon,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  icon: ReactNode
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
        {icon}
      </span>
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn('pl-8', value ? 'pr-8' : 'pr-3')}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Clear"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

// ---- Date input with external clear button ----

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="flex size-7 shrink-0 items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Clear date"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

// ---- Date range field ----

function DateRangeField({
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5">
        <DateInput value={from} onChange={onFrom} />
        <span className="shrink-0 text-muted-foreground">–</span>
        <DateInput value={to} onChange={onTo} />
      </div>
    </div>
  )
}

// ---- Filters bar ----

function FiltersBar({
  urlFilters,
  localSearch,
  localOwner,
  onLocalSearch,
  onLocalOwner,
  onDateFilter,
  onClear,
}: {
  urlFilters: FilterState
  localSearch: string
  localOwner: string
  onLocalSearch: (v: string) => void
  onLocalOwner: (v: string) => void
  onDateFilter: (key: keyof FilterState, v: string) => void
  onClear: () => void
}) {
  const anyActive =
    localSearch !== '' ||
    localOwner !== '' ||
    urlFilters.updatedFrom !== '' ||
    urlFilters.updatedTo !== '' ||
    urlFilters.createdFrom !== '' ||
    urlFilters.createdTo !== ''

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-base font-semibold">Filters</span>
        <Button
          variant="ghost"
          size="sm"
          className={cn('gap-1.5 text-muted-foreground hover:text-foreground h-7', !anyActive && 'invisible pointer-events-none')}
          onClick={onClear}
          tabIndex={anyActive ? 0 : -1}
          aria-hidden={!anyActive}
        >
          <X className="size-3.5" />
          Clear filters
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Title or slug</Label>
          <FilterInput
            value={localSearch}
            onChange={onLocalSearch}
            placeholder="Search by title or slug…"
            icon={<Search className="size-3.5" />}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Owner</Label>
          <FilterInput
            value={localOwner}
            onChange={onLocalOwner}
            placeholder="Filter by owner name…"
            icon={<Search className="size-3.5" />}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <DateRangeField
          label="Last edited"
          from={urlFilters.updatedFrom}
          to={urlFilters.updatedTo}
          onFrom={(v) => onDateFilter('updatedFrom', v)}
          onTo={(v) => onDateFilter('updatedTo', v)}
        />
        <DateRangeField
          label="Date created"
          from={urlFilters.createdFrom}
          to={urlFilters.createdTo}
          onFrom={(v) => onDateFilter('createdFrom', v)}
          onTo={(v) => onDateFilter('createdTo', v)}
        />
      </div>
    </div>
  )
}

// ---- Inner list — a real component so it can call hooks ----

function ProjectsList({
  api,
  urlFilters,
  localSearch,
  localOwner,
  onLocalSearch,
  onLocalOwner,
  onDateFilter,
  onClear,
}: {
  api: ListApi<PublicProject>
  urlFilters: FilterState
  localSearch: string
  localOwner: string
  onLocalSearch: (v: string) => void
  onLocalOwner: (v: string) => void
  onDateFilter: (key: keyof FilterState, v: string) => void
  onClear: () => void
}) {
  useEffect(() => {
    api.setFilters(toFilterList(urlFilters))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFilters])

  const anyActive =
    localSearch !== '' ||
    localOwner !== '' ||
    Object.values(urlFilters).some((v) => v !== '')

  return (
    <div className="flex flex-col gap-6">
      <FiltersBar
        urlFilters={urlFilters}
        localSearch={localSearch}
        localOwner={localOwner}
        onLocalSearch={onLocalSearch}
        onLocalOwner={onLocalOwner}
        onDateFilter={onDateFilter}
        onClear={onClear}
      />

      {api.data.length === 0 ? (
        <EmptyState
          className="mt-8"
          accent="muted"
          icon={<SearchX />}
          title="No public projects"
          hint={
            anyActive
              ? 'No projects match your current filters.'
              : 'There are no public projects to browse right now.'
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {api.data.map((p) => (
            <PublicProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      <Pagination
        pagination={api.pagination}
        onPageChange={api.setPage}
        onPageSizeChange={api.setPageSize}
        pageSizeOptions={[10, 25, 50]}
      />
    </div>
  )
}

// ---- Page ----

export default function PublicProjectsPage() {
  useDocumentTitle(`Public projects · ${APP_NAME}`)

  const [searchParams, setSearchParams] = useSearchParams()

  const [localSearch, setLocalSearch] = useState(() => searchParams.get('search') ?? '')
  const [localOwner, setLocalOwner] = useState(() => searchParams.get('owner') ?? '')

  const dSearch = useDebounce(localSearch, 300)
  const dOwner = useDebounce(localOwner, 300)

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (dSearch) n.set('search', dSearch)
        else n.delete('search')
        return n
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dSearch])

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (dOwner) n.set('owner', dOwner)
        else n.delete('owner')
        return n
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dOwner])

  const setDateFilter = (key: keyof FilterState, value: string) => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (value) n.set(key, value)
        else n.delete(key)
        return n
      },
      { replace: true },
    )
  }

  const clearAll = () => {
    setLocalSearch('')
    setLocalOwner('')
    setSearchParams({}, { replace: true })
  }

  const urlFilters: FilterState = {
    search: searchParams.get('search') ?? '',
    owner: searchParams.get('owner') ?? '',
    updatedFrom: searchParams.get('updatedFrom') ?? '',
    updatedTo: searchParams.get('updatedTo') ?? '',
    createdFrom: searchParams.get('createdFrom') ?? '',
    createdTo: searchParams.get('createdTo') ?? '',
  }

  return (
    <PageLayout>
      <PageHeader
        title="Public projects"
        description={`Browse everything shared openly on ${APP_NAME}.`}
      />

      <List
        useQuery={usePublicProjectsQuery}
        storeKey="public-projects"
        defaultSort={[{ field: 'updated_at', dir: 'desc' }]}
        initialPageSize={10}
      >
        {(api) => (
          <ProjectsList
            api={api}
            urlFilters={urlFilters}
            localSearch={localSearch}
            localOwner={localOwner}
            onLocalSearch={setLocalSearch}
            onLocalOwner={setLocalOwner}
            onDateFilter={setDateFilter}
            onClear={clearAll}
          />
        )}
      </List>
    </PageLayout>
  )
}
