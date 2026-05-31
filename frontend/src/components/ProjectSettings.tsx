import { useEffect, useState } from 'react'
import { Globe, Lock, Trash2, UserPlus } from 'lucide-react'
import Modal from './Modal'
import {
  addMember,
  findUserByEmail,
  listProjectMembers,
  removeMember,
  setProjectPublic,
} from '../lib/crud'
import type { MemberInfo, MemberRole, Project } from '../lib/types'

export default function ProjectSettings({
  project,
  onClose,
  onSaved,
}: {
  project: Project
  onClose: () => void
  onSaved: () => void
}) {
  const [isPublic, setIsPublic] = useState(project.is_public)
  const [members, setMembers] = useState<MemberInfo[] | null>(null)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MemberRole>('viewer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = () => listProjectMembers(project.id).then(setMembers).catch(() => setMembers([]))
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const togglePublic = () =>
    guard(async () => {
      const next = !isPublic
      await setProjectPublic(project.id, next)
      setIsPublic(next)
    })

  const invite = () =>
    guard(async () => {
      const target = email.trim()
      if (!target) return
      const u = await findUserByEmail(target)
      if (!u) {
        setError('No user found with that email. They need to sign up first.')
        return
      }
      await addMember(project.id, u.id, inviteRole)
      setEmail('')
      await reload()
    })

  const changeRole = (userId: string, role: MemberRole) =>
    guard(async () => {
      await addMember(project.id, userId, role)
      await reload()
    })

  const remove = (userId: string) =>
    guard(async () => {
      await removeMember(project.id, userId)
      await reload()
    })

  return (
    <Modal
      title={`Share — ${project.name}`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="share-section">
        <div className="field-label">General access</div>
        <button className={`vis-toggle ${isPublic ? 'on' : ''}`} disabled={busy} onClick={() => void togglePublic()}>
          {isPublic ? <Globe size={18} /> : <Lock size={18} />}
          <div>
            <div className="vis-option-label">{isPublic ? 'Public' : members && members.length ? 'Shared' : 'Private'}</div>
            <div className="vis-option-desc">
              {isPublic ? 'Anyone, including logged-out visitors, can view.' : 'Only you, staff, and invited people.'}
            </div>
          </div>
          <span className={`switch ${isPublic ? 'on' : ''}`} aria-hidden />
        </button>
      </div>

      <div className="share-section">
        <div className="field-label">Invite people</div>
        <form
          className="invite-row"
          onSubmit={(e) => {
            e.preventDefault()
            void invite()
          }}
        >
          <input
            className="text-input"
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="role-select"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as MemberRole)}
          >
            <option value="viewer">can view</option>
            <option value="editor">can edit</option>
          </select>
          <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
            <UserPlus size={15} /> Add
          </button>
        </form>
        {error && <div className="form-error">{error}</div>}

        <div className="share-list">
          {!members && <div className="muted member-empty">Loading…</div>}
          {members && members.length === 0 && <div className="muted member-empty">No one invited yet.</div>}
          {members?.map((m) => (
            <div key={m.user_id} className="share-item">
              <span className="share-name">{m.name || m.email || m.user_id}</span>
              <select
                className="role-select"
                value={m.role}
                disabled={busy}
                onChange={(e) => void changeRole(m.user_id, e.target.value as MemberRole)}
              >
                <option value="viewer">can view</option>
                <option value="editor">can edit</option>
              </select>
              <button className="icon-btn" title="Remove" disabled={busy} onClick={() => void remove(m.user_id)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
