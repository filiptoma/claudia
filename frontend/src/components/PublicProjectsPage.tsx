import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarIcon, Globe, Search, X } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { createSupabaseListQuery } from '../lib/listQuery'
import { projectPath } from '../lib/paths'
import { List, Pagination } from './data'
import type { Filter, ListApi, RangeValue } from './data'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import EmptyState from './EmptyState'
import ProfileAvatar from './ProfileAvatar'
import type { PublicProject } from '../lib/types'
import { APP_NAME } from '../lib/brand'

const usePublicProjectsQuery = createSupabaseListQuery<PublicProject>({
  rpc: 'list_public_projects',
  queryKey: 'public-projects',
  defaultSort: [{ field: 'updated_at', dir: 'desc' }],
})

// Typed filter state (easier to bind to form inputs than raw Filter[])
interface FilterState {
  search: string
  owner: string
  updatedFrom: string
  updatedTo: string
  createdFrom: string
  createdTo: string
}

const EMPTY_FILTERS: FilterState = {
  search: '',
  owner: '',
  updatedFrom: '',
  updatedTo: '',
  createdFrom: '',
  createdTo: '',
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

// ---- Filters UI component ----

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
  const inputCls =
    'h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50'
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <CalendarIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className={inputCls} />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">–</span>
        <div className="relative flex-1">
          <CalendarIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input type="date" value={to} onChange={(e) => onTo(e.target.value)} className={inputCls} />
        </div>
      </div>
    </div>
  )
}

function FiltersBar({
  values,
  onChange,
}: {
  values: FilterState
  onChange: (f: FilterState) => void
}) {
  const set = (key: keyof FilterState) => (v: string) => onChange({ ...values, [key]: v })
  const anyActive = Object.values(values).some((v) => v !== '')

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-2">
          <Label className="text-xs text-muted-foreground">Title</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search project titles…"
              value={values.search}
              onChange={(e) => set('search')(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Owner</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter by owner name…"
              value={values.owner}
              onChange={(e) => set('owner')(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {anyActive && (
          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => onChange(EMPTY_FILTERS)}
            >
              <X className="size-3.5" />
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <DateRangeField
          label="Last edited"
          from={values.updatedFrom}
          to={values.updatedTo}
          onFrom={set('updatedFrom')}
          onTo={set('updatedTo')}
        />
        <DateRangeField
          label="Date created"
          from={values.createdFrom}
          to={values.createdTo}
          onFrom={set('createdFrom')}
          onTo={set('createdTo')}
        />
      </div>
    </div>
  )
}

// ---- Project card ----

function ProjectCard({ project }: { project: PublicProject }) {
  const navigate = useNavigate()
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

  return (
    <button
      onClick={() => navigate(projectPath(project.slug))}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent2/12 text-accent2">
          <Globe className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 font-semibold leading-snug transition-colors group-hover:text-primary">
            {project.name}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {project.document_count} {project.document_count === 1 ? 'document' : 'documents'}
          </div>
        </div>
      </div>

      {project.owner && (
        <div onClick={(e) => e.stopPropagation()}>
          <ProfileAvatar
            userId={project.owner}
            name={project.owner_name}
            email={null}
            avatarUrl={project.owner_avatar_url}
            variant="inline"
            size="sm"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Updated {fmt(project.updated_at)}</span>
        <span>Created {fmt(project.created_at)}</span>
      </div>
    </button>
  )
}

// ---- Inner list — a real component so it can call hooks ----

function ProjectsList({
  api,
  filters,
  setFilters,
}: {
  api: ListApi<PublicProject>
  filters: FilterState
  setFilters: (f: FilterState) => void
}) {
  // Sync typed UI filter state into the List's internal Filter[] state.
  // Stable reference: api.setFilters comes from Zustand and doesn't change identity.
  useEffect(() => {
    api.setFilters(toFilterList(filters))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  return (
    <div className="flex flex-col gap-6">
      <FiltersBar values={filters} onChange={setFilters} />

      {api.data.length === 0 ? (
        <EmptyState
          accent="muted"
          icon={<Globe />}
          title="No public projects"
          hint={
            Object.values(filters).some((v) => v !== '')
              ? 'No projects match your current filters.'
              : 'There are no public projects to browse right now.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {api.data.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      {api.pagination.total > api.pagination.pageSize && (
        <Pagination
          pagination={api.pagination}
          onPageChange={api.setPage}
          onPageSizeChange={api.setPageSize}
          pageSizeOptions={[12, 24, 48]}
        />
      )}
    </div>
  )
}

// ---- Page ----

export default function PublicProjectsPage() {
  useDocumentTitle(`Public projects · ${APP_NAME}`)

  const [searchParams] = useSearchParams()
  const initialOwner = searchParams.get('owner') ?? ''

  const [filters, setFilters] = useState<FilterState>({ ...EMPTY_FILTERS, owner: initialOwner })

  return (
    <div className="mx-auto w-full max-w-7xl px-8 pt-10 pb-24 max-md:px-5 max-md:pt-14">
      <header className="mb-8 border-b border-border pb-8">
        <h1 className="text-[2rem] font-bold tracking-tight">Public projects</h1>
        <p className="mt-1 text-muted-foreground">Browse everything shared openly on {APP_NAME}.</p>
      </header>

      <List
        useQuery={usePublicProjectsQuery}
        storeKey="public-projects"
        defaultSort={[{ field: 'updated_at', dir: 'desc' }]}
        initialPageSize={12}
      >
        {(api) => <ProjectsList api={api} filters={filters} setFilters={setFilters} />}
      </List>
    </div>
  )
}
