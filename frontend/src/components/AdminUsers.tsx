import { useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import type { ColumnHelper } from '@tanstack/react-table'

import { useAuth } from '../context/AuthContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { createSupabaseListQuery } from '../lib/listQuery'
import type { Profile } from '../lib/types'
import { List, Pagination, Table } from './data'
import { Badge } from '@/components/ui/badge'

// Profiles are only readable by admins (RLS), so this page stays admin-only.
const useUsersQuery = createSupabaseListQuery<Profile>({
  table: 'profiles',
  queryKey: 'admin-users',
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
})

const roleOptions = [
  { label: 'Basic', value: 'basic' },
  { label: 'Mod', value: 'mod' },
  { label: 'Admin', value: 'admin' },
]

export default function AdminUsers() {
  const { user, isAdmin } = useAuth()
  useDocumentTitle('Users')

  const buildColumns = useCallback(
    (col: ColumnHelper<Profile>) => [
      col.accessor('name', {
        header: 'Name',
        meta: { filter: { type: 'text', placeholder: 'Search name…' } },
        cell: (ctx) => <span className="font-medium">{ctx.getValue() || '—'}</span>,
      }),
      col.accessor('email', {
        header: 'Email',
        meta: { filter: { type: 'text', placeholder: 'Search email…' } },
        cell: (ctx) =>
          ctx.getValue() || <span className="text-muted-foreground">hidden</span>,
      }),
      col.accessor('role', {
        header: 'Role',
        meta: { filter: { type: 'multiselect', options: roleOptions, placeholder: 'Role' } },
        cell: (ctx) => {
          const role = ctx.getValue()
          return (
            <Badge
              variant={role === 'admin' ? 'destructive' : role === 'mod' ? 'default' : 'secondary'}
            >
              {role}
            </Badge>
          )
        },
      }),
      col.accessor('created_at', {
        header: 'Joined',
        meta: { filter: { type: 'dateRange' } },
        cell: (ctx) => (
          <span className="text-muted-foreground">
            {new Date(ctx.getValue()).toLocaleDateString()}
          </span>
        ),
      }),
    ],
    [],
  )

  // Auth has resolved by the time this renders (app-level gate), so this check is final.
  if (!user || !isAdmin) return <Navigate to="/" replace />

  return (
    <div className="w-full px-8 pt-7 pb-20 max-md:px-5">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Users</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Change a user's role with{' '}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
          update public.profiles set role = 'mod' where email = '…';
        </code>{' '}
        in the Supabase SQL editor. They'll need to sign in again for it to take effect.
      </p>

      <List
        useQuery={useUsersQuery}
        storeKey="admin-users"
        defaultSort={[{ field: 'created_at', dir: 'desc' }]}
      >
        {({ data, sort, setSort, filters, setFilters, pagination, setPage, setPageSize }) => (
          <div className="flex flex-col gap-4">
            <Table
              data={data}
              columns={buildColumns}
              sortControl={{ sort, onChange: setSort }}
              filterControl={{ filters, onChange: setFilters }}
              getRowId={(u) => u.id}
              noData="No users yet."
            />
            <Pagination pagination={pagination} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </List>
    </div>
  )
}
