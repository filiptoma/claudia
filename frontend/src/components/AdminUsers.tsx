import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Profile } from '../lib/types'

export default function AdminUsers() {
  const { user, isAdmin } = useAuth()
  const [users, setUsers] = useState<Profile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setUsers((data as Profile[]) ?? [])
      })
  }, [isAdmin])

  if (!user || !isAdmin) return <Navigate to="/" replace />

  return (
    <div className="admin">
      <h1>Users</h1>
      <p className="admin-note">
        Change a user's role with: <code>update public.profiles set role = 'mod' where email = '…';</code> in
        the Supabase SQL editor. They'll need to sign in again for it to take effect.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="md-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id}>
                <td>{u.name || '—'}</td>
                <td>{u.email || <span className="muted">hidden</span>}</td>
                <td>
                  <span className={`role-badge role-${u.role}`}>{u.role}</span>
                </td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {users && users.length === 0 && <p className="muted">No users yet.</p>}
      {!users && !error && <p className="muted">Loading…</p>}
    </div>
  )
}
