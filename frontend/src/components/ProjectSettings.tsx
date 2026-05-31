import { useEffect, useState } from 'react'
import { Globe, Lock, Users } from 'lucide-react'
import Modal from './Modal'
import { pb } from '../lib/pb'
import { setProjectAccess } from '../lib/crud'
import type { Project, UserRec, Visibility } from '../lib/types'

const OPTIONS: { value: Visibility; label: string; desc: string; Icon: typeof Lock }[] = [
  { value: 'private', label: 'Private', desc: 'Only admins can see this project.', Icon: Lock },
  { value: 'public', label: 'Public', desc: 'Everyone can see this project.', Icon: Globe },
  { value: 'shared', label: 'Shared', desc: 'Admins and the selected users can see it.', Icon: Users },
]

export default function ProjectSettings({
  project,
  onClose,
  onSaved,
}: {
  project: Project
  onClose: () => void
  onSaved: () => void
}) {
  const [visibility, setVisibility] = useState<Visibility>(project.visibility || 'private')
  const [selected, setSelected] = useState<string[]>(project.sharedUsers ?? [])
  const [users, setUsers] = useState<UserRec[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    pb.collection('users')
      .getFullList<UserRec>({ sort: 'name,email', requestKey: null })
      .then(setUsers)
      .catch(() => setUsers([]))
  }, [])

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await setProjectAccess(project.id, visibility, selected)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Access — ${project.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="vis-options">
        {OPTIONS.map(({ value, label, desc, Icon }) => (
          <label key={value} className={`vis-option ${visibility === value ? 'active' : ''}`}>
            <input
              type="radio"
              name="visibility"
              checked={visibility === value}
              onChange={() => setVisibility(value)}
            />
            <Icon size={18} className="vis-option-icon" />
            <div>
              <div className="vis-option-label">{label}</div>
              <div className="vis-option-desc">{desc}</div>
            </div>
          </label>
        ))}
      </div>

      {visibility === 'shared' && (
        <div className="share-users">
          <div className="field-label">Shared with</div>
          {!users && <div className="muted">Loading users…</div>}
          {users && users.length === 0 && <div className="muted">No users available.</div>}
          <div className="share-list">
            {users?.map((u) => (
              <label key={u.id} className="share-item">
                <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                <span className="share-name">{u.name || u.email || u.id}</span>
                <span className={`role-badge role-${u.role || 'viewer'}`}>{u.role || 'viewer'}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
    </Modal>
  )
}
