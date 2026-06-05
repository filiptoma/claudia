import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Globe, Lock, Trash2, UserPlus } from 'lucide-react'
import {
  addMember,
  findUserByEmail,
  getProjectOwner,
  listProjectMembers,
  removeMember,
  setProjectPublic,
} from '../lib/crud'
import { useAuth } from '../context/AuthContext'
import { useTree } from '../hooks/useTree'
import { useRouteContext } from '../hooks/useRouteContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { canConfigureProject } from '../lib/access'
import { toast } from '../lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import QuerySuspense from './QuerySuspense'
import ProfileAvatar from './ProfileAvatar'
import { cn } from '@/lib/utils'
import type { MemberInfo, MemberRole } from '../lib/types'

const inviteSchema = z.object({ email: z.email('Enter a valid email address') })
type InviteValues = z.infer<typeof inviteSchema>

function RoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: MemberRole
  disabled?: boolean
  onChange: (r: MemberRole) => void
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(v) => onChange(v as MemberRole)}>
      <SelectTrigger className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="viewer">can view</SelectItem>
        <SelectItem value="editor">can edit</SelectItem>
      </SelectContent>
    </Select>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto mt-[12vh] max-w-xl px-6 text-center">
      <h1 className="mb-3 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mb-6 text-muted-foreground">{body}</p>
      <Button variant="outline" asChild>
        <Link to="/">Go home</Link>
      </Button>
    </div>
  )
}

export default function ProjectSettings() {
  const { project, projectSlug } = useRouteContext()
  const { role, uid } = useAuth()
  const { refresh, queries } = useTree()

  useDocumentTitle(project ? `${project.name} · Settings` : undefined)

  const [isPublic, setIsPublic] = useState(false)
  const [members, setMembers] = useState<MemberInfo[] | null>(null)
  const [owner, setOwner] = useState<{ id: string; name: string | null; email: string | null; avatar_url: string | null } | null>(null)
  const [inviteRole, setInviteRole] = useState<MemberRole>('viewer')
  const [busy, setBusy] = useState(false)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '' },
  })

  // Sync the visibility toggle to the resolved project without an effect (adjust-during-render).
  const projectId = project?.id
  const [trackedId, setTrackedId] = useState(projectId)
  if (trackedId !== projectId) {
    setTrackedId(projectId)
    setIsPublic(project?.is_public ?? false)
  }
  useEffect(() => {
    if (projectId) listProjectMembers(projectId).then(setMembers).catch(() => setMembers([]))
  }, [projectId])

  useEffect(() => {
    if (projectId && project?.owner) {
      getProjectOwner(projectId).then(setOwner).catch(() => setOwner(null))
    }
  }, [projectId, project?.owner])

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      void refresh()
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  const reload = () => {
    if (projectId) return listProjectMembers(projectId).then(setMembers).catch(() => setMembers([]))
  }

  const togglePublic = () =>
    guard(async () => {
      if (!project) return
      const next = !isPublic
      await setProjectPublic(project.id, next)
      setIsPublic(next)
      toast('success', next ? 'Project is now public' : 'Project is now private')
    })

  const onInvite = handleSubmit((values) =>
    guard(async () => {
      if (!project) return
      const u = await findUserByEmail(values.email.trim())
      if (!u) {
        toast('error', 'No user found with that email. They need to sign up first.')
        return
      }
      await addMember(project.id, u.id, inviteRole)
      reset({ email: '' })
      await reload()
      toast('success', `Invited ${u.name || u.email}`)
    }),
  )

  const changeRole = (userId: string, r: MemberRole) =>
    guard(async () => {
      if (!project) return
      await addMember(project.id, userId, r)
      await reload()
      toast('success', 'Access updated')
    })

  const remove = (userId: string) =>
    guard(async () => {
      if (!project) return
      await removeMember(project.id, userId)
      await reload()
      toast('success', 'Access removed')
    })

  return (
    <QuerySuspense queries={queries} loadingLabel="Loading settings…">
      {(() => {
        if (!project) return <Notice title="Not found" body={`Project “${projectSlug}” doesn’t exist or you can’t access it.`} />
        if (project.is_workspace)
          return <Notice title="No settings" body="Your workspace is private to you and can’t be shared or configured." />
        if (!canConfigureProject(project, role, uid))
          return <Notice title="No access" body="Only the project owner can change these settings." />

        return (
          <div className="mx-auto max-w-2xl px-8 pt-8 pb-20 max-md:px-5">
            <h1 className="mb-1 text-2xl font-bold tracking-tight">Project settings</h1>
            <p className="mb-8 text-sm text-muted-foreground">
              Manage who can see and edit “{project.name}”.
            </p>

            {owner && (
              <section className="mb-8">
                <h2 className="mb-3 text-sm font-semibold">Owner</h2>
                <div className="rounded-xl border border-border bg-card px-4 py-3">
                  <ProfileAvatar
                    userId={owner.id}
                    name={owner.name}
                    email={owner.email}
                    avatarUrl={owner.avatar_url}
                    variant="inline"
                    size="md"
                  />
                </div>
              </section>
            )}

            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold">General access</h2>
              <div
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-4 transition-colors',
                  isPublic ? 'border-primary/50 bg-primary/5' : 'border-border',
                )}
              >
                <span className={cn(isPublic ? 'text-foreground' : 'text-muted-foreground')}>
                  {isPublic ? <Globe className="size-5" /> : <Lock className="size-5" />}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-semibold">
                    {isPublic ? 'Public' : members && members.length ? 'Shared' : 'Private'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {isPublic
                      ? 'Anyone, including logged-out visitors, can view.'
                      : 'Only you, staff, and invited people.'}
                  </div>
                </div>
                <Switch checked={isPublic} disabled={busy} onCheckedChange={() => void togglePublic()} />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold">Invite people</h2>
              <form className="flex items-start gap-2" onSubmit={onInvite} noValidate>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    aria-invalid={!!errors.email}
                    {...register('email')}
                  />
                  {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                </div>
                <RoleSelect value={inviteRole} onChange={setInviteRole} />
                <Button type="submit" disabled={busy}>
                  <UserPlus /> Add
                </Button>
              </form>

              <div className="mt-3 overflow-hidden rounded-xl border border-border">
                {!members && <div className="p-3 text-center text-sm text-muted-foreground">Loading…</div>}
                {members && members.length === 0 && (
                  <div className="p-3 text-center text-sm text-muted-foreground">No one invited yet.</div>
                )}
                {members?.map((m) => (
                  <div
                    key={m.user_id}
                    className="flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0"
                  >
                    <ProfileAvatar
                      userId={m.user_id}
                      name={m.name}
                      email={m.email}
                      avatarUrl={null}
                      variant="inline"
                      size="sm"
                      className="min-w-0 flex-1"
                    />
                    <RoleSelect value={m.role} disabled={busy} onChange={(r) => void changeRole(m.user_id, r)} />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Remove"
                          disabled={busy}
                          onClick={() => void remove(m.user_id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )
      })()}
    </QuerySuspense>
  )
}
