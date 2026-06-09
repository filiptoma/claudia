import { useCallback, useEffect, useState } from 'react'
import { Copy, LinkIcon, Lock, Trash2, UserPlus } from 'lucide-react'
import {
  createInviteLink,
  listInviteLinks,
  listProjectMembers,
  listResourceGrants,
  removeResourceGrant,
  revokeInviteLink,
  setDocumentPrivate,
  setFolderPrivate,
  setResourceGrant,
} from '../lib/crud'
import { inviteUrl } from '../lib/paths'
import { toast } from '../lib/toast'
import type { InviteLink, MemberInfo, MemberRole, Project, ResourceGrantInfo } from '../lib/types'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ProfileAvatar from './ProfileAvatar'

// A target is a single folder or document within a project.
export interface ResourceTarget {
  kind: 'folder' | 'document'
  id: string
  name: string
  projectId: string
}

const target = (t: ResourceTarget) =>
  t.kind === 'folder' ? { folderId: t.id } : { documentId: t.id }

const ROLE_LABEL: Record<MemberRole, string> = {
  viewer: 'can view',
  commenter: 'can comment',
  editor: 'can edit',
}

function RoleSelect({
  value,
  onChange,
  disabled,
  hideCommenter,
  roles,
}: {
  value: MemberRole
  onChange: (r: MemberRole) => void
  disabled?: boolean
  // LaTeX has no commenter tier (§3.4).
  hideCommenter?: boolean
  // Explicit list of selectable roles (overrides hideCommenter). Used to hide already-issued link types.
  roles?: MemberRole[]
}) {
  const list =
    roles ?? (['viewer', 'commenter', 'editor'] as MemberRole[]).filter((r) => !(hideCommenter && r === 'commenter'))
  return (
    <Select value={value} disabled={disabled} onValueChange={(v) => onChange(v as MemberRole)}>
      <SelectTrigger className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {list.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('success', 'Link copied')
  } catch {
    toast('error', 'Couldn’t copy — copy it manually')
  }
}

// ---- grantees of a private resource ----
function GranteesManager({ project, t, onChanged }: { project: Project; t: ResourceTarget; onChanged: () => void }) {
  const [grantees, setGrantees] = useState<ResourceGrantInfo[] | null>(null)
  const [members, setMembers] = useState<MemberInfo[] | null>(null)
  const [addUser, setAddUser] = useState('')
  const [addRole, setAddRole] = useState<MemberRole>('viewer')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    listResourceGrants(target(t)).then(setGrantees).catch(() => setGrantees([]))
  }, [t])

  useEffect(() => {
    reload()
    // Private projects grant from the existing member pool; public projects use links only.
    if (!project.is_public) listProjectMembers(project.id).then(setMembers).catch(() => setMembers([]))
  }, [reload, project.is_public, project.id])

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      reload()
      onChanged()
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const grantedIds = new Set((grantees ?? []).map((g) => g.user_id))
  const candidates = (members ?? []).filter((m) => !grantedIds.has(m.user_id))

  return (
    <div className="flex flex-col gap-2">
      {/* Private projects: pick from existing members. Public projects grant via link only. */}
      {!project.is_public && candidates.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={addUser} onValueChange={setAddUser} disabled={busy}>
            <SelectTrigger className="min-w-0 flex-1">
              <SelectValue placeholder="Add a member…" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.name || m.email || m.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <RoleSelect value={addRole} onChange={setAddRole} disabled={busy} />
          <Button
            disabled={busy || !addUser}
            onClick={() =>
              void guard(async () => {
                await setResourceGrant({ projectId: project.id, ...target(t) }, addUser, addRole)
                setAddUser('')
                toast('success', 'Access granted')
              })
            }
          >
            <UserPlus /> Add
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        {!grantees && <div className="p-3 text-center text-sm text-muted-foreground">Loading…</div>}
        {grantees && grantees.length === 0 && (
          <div className="p-3 text-center text-sm text-muted-foreground">
            No one has access yet{project.is_public ? ' — share a link below.' : '.'}
          </div>
        )}
        {grantees?.map((g) => (
          <div key={g.user_id} className="flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
            <ProfileAvatar
              userId={g.user_id}
              name={g.name}
              email={g.email}
              avatarUrl={g.avatar_url}
              variant="inline"
              size="sm"
              className="min-w-0 flex-1"
            />
            <RoleSelect
              value={g.role}
              disabled={busy}
              onChange={(r) =>
                void guard(async () => {
                  await setResourceGrant({ projectId: project.id, ...target(t) }, g.user_id, r)
                  toast('success', 'Access updated')
                })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Remove access"
              disabled={busy}
              onClick={() =>
                void guard(async () => {
                  await removeResourceGrant(target(t), g.user_id)
                  toast('success', 'Access removed')
                })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- share links for a target (resource-level here; project-level via ProjectInviteLinks) ----
export function InviteLinksManager({
  project,
  t,
  hideCommenter,
}: {
  project: Project
  // Omit `t` for a whole-project link.
  t?: ResourceTarget
  hideCommenter?: boolean
}) {
  const [links, setLinks] = useState<InviteLink[] | null>(null)
  const [role, setRole] = useState<MemberRole>('viewer')
  const [busy, setBusy] = useState(false)
  const filter = t ? target(t) : undefined

  const reload = useCallback(() => {
    listInviteLinks(project.id, filter).then(setLinks).catch(() => setLinks([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, t?.id])

  useEffect(() => reload(), [reload])

  const active = (links ?? []).filter((l) => !l.revoked)
  // One link per permission type: only offer roles that don't already have an active link.
  const used = new Set(active.map((l) => l.role))
  const base: MemberRole[] = hideCommenter ? ['viewer', 'editor'] : ['viewer', 'commenter', 'editor']
  const available = base.filter((r) => !used.has(r))
  const effectiveRole = available.includes(role) ? role : (available[0] ?? role)
  const noneLeft = available.length === 0

  const create = () =>
    void (async () => {
      setBusy(true)
      try {
        const token = await createInviteLink({
          projectId: project.id,
          folderId: t?.kind === 'folder' ? t.id : null,
          documentId: t?.kind === 'document' ? t.id : null,
          role: effectiveRole,
        })
        await copy(inviteUrl(token))
        reload()
      } catch (e) {
        toast('error', e instanceof Error ? e.message : 'Couldn’t create link')
      } finally {
        setBusy(false)
      }
    })()

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <RoleSelect
          value={effectiveRole}
          onChange={setRole}
          disabled={busy || noneLeft}
          roles={available}
        />
        <Button
          variant="soft"
          disabled={busy || noneLeft}
          onClick={create}
          className="flex-1 md:flex-none"
        >
          <LinkIcon /> Create link
        </Button>
      </div>
      {noneLeft && links !== null && (
        <p className="text-xs text-muted-foreground">
          A link exists for every permission. Revoke one below to create a different type.
        </p>
      )}
      {active.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          {active.map((l) => (
            <div key={l.id} className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0">
              <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                Anyone with the link · can {l.role === 'editor' ? 'edit' : l.role === 'commenter' ? 'comment' : 'view'}
                {l.expires_at ? ' · expires' : ''}
              </span>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Copy link" onClick={() => void copy(inviteUrl(l.token))}>
                <Copy className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Revoke link"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true)
                    try {
                      await revokeInviteLink(l.id)
                      reload()
                      toast('success', 'Link revoked')
                    } catch (e) {
                      toast('error', e instanceof Error ? e.message : 'Couldn’t revoke')
                    } finally {
                      setBusy(false)
                    }
                  })()
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The owner's control for a single folder/document: a Private toggle plus, when private, grantee +
 * share-link management. Shared by the inline Permissions dialog and the Project Settings Access panel.
 * Markdown-only; the DB is the real gate (migrations 0023/0024).
 */
export default function ResourceAccessManager({
  project,
  t,
  isPrivate,
  onChanged,
  onPrivacyChange,
}: {
  project: Project
  t: ResourceTarget
  isPrivate: boolean
  onChanged: () => void
  onPrivacyChange?: (isPrivate: boolean) => void
}) {
  const [priv, setPriv] = useState(isPrivate)
  const [busy, setBusy] = useState(false)

  // Re-sync when the dialog is reused for a different resource.
  const [trackedId, setTrackedId] = useState(t.id)
  if (trackedId !== t.id) {
    setTrackedId(t.id)
    setPriv(isPrivate)
  }

  const togglePrivate = () =>
    void (async () => {
      setBusy(true)
      const next = !priv
      try {
        if (t.kind === 'folder') await setFolderPrivate(t.id, next)
        else await setDocumentPrivate(t.id, next)
        setPriv(next)
        onPrivacyChange?.(next)
        onChanged()
        toast('success', next ? `${t.kind === 'folder' ? 'Folder' : 'Document'} is now private` : 'Now follows project access')
      } catch (e) {
        toast('error', e instanceof Error ? e.message : 'Couldn’t update privacy')
      } finally {
        setBusy(false)
      }
    })()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-lg border border-border p-3">
        <Lock className={priv ? 'size-5 text-foreground' : 'size-5 text-muted-foreground'} />
        <div className="flex-1">
          <div className="text-sm font-semibold">Private</div>
          <div className="text-xs text-muted-foreground">
            Hidden from everyone except you and the people you give access to.
          </div>
        </div>
        <Switch checked={priv} disabled={busy} onCheckedChange={togglePrivate} />
      </div>

      {priv && (
        <>
          <div>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">People with access</h4>
            <GranteesManager project={project} t={t} onChanged={onChanged} />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Share link</h4>
            <p className="mb-2 text-xs text-muted-foreground">
              {project.is_public
                ? 'Anyone who signs in and opens the link gets the chosen access to this item.'
                : 'Only existing project members who open the link get access.'}
            </p>
            <InviteLinksManager project={project} t={t} />
          </div>
        </>
      )}
    </div>
  )
}
