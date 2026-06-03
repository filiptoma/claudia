import { useCallback } from 'react'
import { Link, Navigate } from 'react-router-dom'
import type { ColumnHelper } from '@tanstack/react-table'
import { ExternalLink } from 'lucide-react'

import { useAuth } from '../context/AuthContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { createSupabaseListQuery } from '../lib/listQuery'
import { List, Pagination, Table } from './data'
import { Badge } from '@/components/ui/badge'

// Rows come from the `admin_projects()` SECURITY DEFINER function (migration 0006): every
// non-workspace project, with its owner resolved server-side. The function fails closed — it raises
// for non-staff callers — so this is gated in the database, not just in the UI.
type AdminProject = {
  id: string
  name: string
  slug: string
  is_public: boolean
  owner: string | null
  owner_name: string | null
  owner_email: string | null
  created_at: string
  updated_at: string
}

const useProjectsQuery = createSupabaseListQuery<AdminProject>({
  rpc: 'admin_projects',
  queryKey: 'admin-projects',
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
})

const visibilityOptions = [
  { label: 'Public', value: 'true' },
  { label: 'Private', value: 'false' },
]

const fmtDate = (v: string) => new Date(v).toLocaleDateString()

export default function AdminProjects() {
  const { isStaff } = useAuth()
  useDocumentTitle('Projects')

  const buildColumns = useCallback(
    (col: ColumnHelper<AdminProject>) => [
      col.accessor('name', {
        header: 'Name',
        meta: { filter: { type: 'text', placeholder: 'Search name…' } },
        cell: (ctx) => <span className="font-medium">{ctx.getValue()}</span>,
      }),
      col.accessor('slug', {
        header: 'Slug',
        meta: { filter: { type: 'text', placeholder: 'Search slug…' } },
        cell: (ctx) => (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            {ctx.getValue()}
          </code>
        ),
      }),
      col.accessor((row) => row.owner_email ?? row.owner_name, {
        id: 'owner',
        header: 'Owner',
        meta: { filter: { type: 'text', field: 'owner_email', placeholder: 'Search owner…' }, sortField: 'owner_email' },
        cell: (ctx) => ctx.getValue() ?? <span className="text-muted-foreground">—</span>,
      }),
      col.accessor('is_public', {
        header: 'Visibility',
        meta: { filter: { type: 'select', options: visibilityOptions, placeholder: 'Any' } },
        cell: (ctx) =>
          ctx.getValue() ? (
            <Badge variant="default">Public</Badge>
          ) : (
            <Badge variant="secondary">Private</Badge>
          ),
      }),
      col.accessor('created_at', {
        header: 'Created',
        meta: { filter: { type: 'dateRange' } },
        cell: (ctx) => <span className="text-muted-foreground">{fmtDate(ctx.getValue())}</span>,
      }),
      col.accessor('updated_at', {
        header: 'Updated',
        meta: { filter: { type: 'dateRange' } },
        cell: (ctx) => <span className="text-muted-foreground">{fmtDate(ctx.getValue())}</span>,
      }),
      col.display({
        id: 'open',
        cell: (ctx) => (
          <Link
            to={`/${ctx.row.original.slug}`}
            className="inline-flex items-center gap-1 text-link hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-3.5" />
            Open
          </Link>
        ),
      }),
    ],
    [],
  )

  if (!isStaff) return <Navigate to="/" replace />

  return (
    <div className="w-full px-8 pt-7 pb-20 max-md:px-5">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">All projects</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Every project in the app (personal workspaces stay private and are never listed here).
      </p>

      <List
        useQuery={useProjectsQuery}
        storeKey="admin-projects"
        defaultSort={[{ field: 'created_at', dir: 'desc' }]}
      >
        {({ data, sort, setSort, filters, setFilters, pagination, setPage, setPageSize }) => (
          <div className="flex flex-col gap-4">
            <Table
              data={data}
              columns={buildColumns}
              sortControl={{ sort, onChange: setSort }}
              filterControl={{ filters, onChange: setFilters }}
              getRowId={(p) => p.id}
              noData="No projects yet."
            />
            <Pagination pagination={pagination} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </List>
    </div>
  )
}
