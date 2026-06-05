import { useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { createColumnHelper } from '@tanstack/react-table'
import { useAuth } from '../context/AuthContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { createSupabaseListQuery } from '../lib/listQuery'
import { List, Table, Pagination } from './data'
import { Badge } from '@/components/ui/badge'
import type { Feedback } from '../lib/types'

const col = createColumnHelper<Feedback>()

const useFeedbackQuery = createSupabaseListQuery<Feedback>({
  rpc: 'list_feedback',
  queryKey: 'admin-feedback',
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
})

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export default function AdminFeedback() {
  const { isStaff } = useAuth()
  useDocumentTitle('Feedback')
  if (!isStaff) return <Navigate to="/" replace />

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const buildColumns = useCallback(
    () => [
      col.accessor('type', {
        header: 'Type',
        meta: {
          filter: {
            type: 'select',
            options: [
              { label: 'Bug report', value: 'bug' },
              { label: 'Feature request', value: 'request' },
            ],
            placeholder: 'All',
          },
        },
        cell: (ctx) =>
          ctx.getValue() === 'bug' ? (
            <Badge variant="destructive">Bug</Badge>
          ) : (
            <Badge variant="default">Request</Badge>
          ),
      }),
      col.accessor('title', {
        header: 'Title',
        meta: { filter: { type: 'text', placeholder: 'Search title…' } },
        cell: (ctx) => <span className="font-medium">{ctx.getValue()}</span>,
      }),
      col.accessor('description', {
        header: 'Description',
        cell: (ctx) => (
          <span className="line-clamp-2 max-w-sm text-sm text-muted-foreground">
            {ctx.getValue()}
          </span>
        ),
      }),
      col.accessor('email', {
        header: 'Email',
        meta: { filter: { type: 'text', placeholder: 'Search email…' } },
        cell: (ctx) => ctx.getValue() ?? <span className="text-muted-foreground">—</span>,
      }),
      col.accessor('created_at', {
        header: 'Submitted',
        meta: { filter: { type: 'dateRange' } },
        cell: (ctx) => (
          <span className="text-muted-foreground">{fmtDate(ctx.getValue())}</span>
        ),
      }),
    ],
    [],
  )

  return (
    <div className="w-full px-8 pt-7 pb-20 max-md:px-5">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Feedback</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Bug reports and feature requests submitted by users.
      </p>

      <List
        useQuery={useFeedbackQuery}
        storeKey="admin-feedback"
        defaultSort={[{ field: 'created_at', dir: 'desc' }]}
      >
        {({ data, sort, setSort, filters, setFilters, pagination, setPage, setPageSize }) => (
          <div className="flex flex-col gap-4">
            <Table
              data={data}
              columns={buildColumns}
              sortControl={{ sort, onChange: setSort }}
              filterControl={{ filters, onChange: setFilters }}
              getRowId={(f) => f.id}
              noData="No feedback yet."
            />
            <Pagination pagination={pagination} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </List>
    </div>
  )
}
