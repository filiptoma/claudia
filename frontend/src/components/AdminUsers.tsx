import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { pb } from '../lib/pb'
import { useAuth } from '../context/AuthContext'
import type { UserRec } from '../lib/types'

export default function AdminUsers() {
  const { user, isAdmin } = useAuth()
  const [users, setUsers] = useState<UserRec[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    pb.collection('users')
      .getFullList<UserRec>({ sort: '-created', requestKey: null })
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load users'))
  }, [isAdmin])

  if (!user || !isAdmin) return <Navigate to="/" replace />

  return (
    <div className="admin">
      <h1>Users</h1>
      <p className="admin-note">
        Roles are changed in the PocketBase dashboard (v1). Promote a user to{' '}
        <code>editor</code> or <code>admin</code> there, then have them sign in again.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="md-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id}>
                <td>{u.name || '—'}</td>
                <td>{u.email || <span className="muted">hidden</span>}</td>
                <td>
                  <span className={`role-badge role-${u.role || 'viewer'}`}>{u.role || 'viewer'}</span>
                </td>
                <td>{new Date(u.created).toLocaleDateString()}</td>
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
