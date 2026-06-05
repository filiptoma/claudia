import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Globe, LogOut, ShieldCheck, Upload } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTree } from '../hooks/useTree'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { supabase } from '../lib/supabase'
import { uploadAvatar } from '../lib/storage'
import { projectPath, publicProjectsPath } from '../lib/paths'
import { toast } from '../lib/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import ProfileAvatar from './ProfileAvatar'
import type { Project } from '../lib/types'

export default function Profile() {
  const { user, uid, role, isStaff, isAdmin, loading, logout, refreshProfile } = useAuth()
  const { refresh } = useTree()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  useDocumentTitle('Profile')

  const [uploading, setUploading] = useState(false)
  const [ownPublicProjects, setOwnPublicProjects] = useState<Project[] | null>(null)

  useEffect(() => {
    if (!uid) return
    void supabase
      .from('projects')
      .select('*')
      .eq('owner', uid)
      .eq('is_public', true)
      .eq('is_workspace', false)
      .order('updated_at', { ascending: false })
      .limit(5)
      .then(({ data }) => setOwnPublicProjects((data as Project[] | null) ?? []))
  }, [uid])

  if (loading) return <div className="p-10 text-muted-foreground">Loading…</div>
  if (!user) return <Navigate to="/" replace />

  const onSignOut = async () => {
    await logout()
    await refresh()
    navigate('/')
  }

  const onAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !uid) return
    setUploading(true)
    try {
      const publicUrl = await uploadAvatar(uid, file)
      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', uid)
      await refreshProfile()
      toast('success', 'Avatar updated')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      // Reset the input so re-selecting the same file still fires onChange
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-8 pt-10 pb-20 max-md:px-5 max-md:pt-14">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Profile</h1>

      {/* — identity card — */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {/* avatar + name row */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <ProfileAvatar
              userId={user.id}
              name={user.name}
              email={user.email}
              avatarUrl={user.avatar_url}
              variant="tooltip"
              size="lg"
              isSelf
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change avatar"
              className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Upload className="size-3" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              onChange={onAvatarChange}
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{user.name || 'Unnamed'}</div>
            <div className="truncate text-sm text-muted-foreground">{user.email || 'No email on file'}</div>
          </div>
        </div>

        <Separator className="my-5" />

        <dl className="grid grid-cols-[7rem_1fr] gap-y-3 text-sm">
          <dt className="text-muted-foreground">Role</dt>
          <dd>
            <Badge variant={role === 'admin' ? 'destructive' : role === 'mod' ? 'default' : 'secondary'}>
              {role}
            </Badge>
          </dd>
          <dt className="text-muted-foreground">Member since</dt>
          <dd>{new Date(user.created_at).toLocaleDateString()}</dd>
        </dl>

        <Separator className="my-5" />

        <Button variant="outline" onClick={() => void onSignOut()}>
          <LogOut /> Sign out
        </Button>
      </div>

      {/* — own public projects preview — */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            <Globe className="size-3.5" /> My public projects
          </h2>
          <Link
            to={publicProjectsPath({ owner: user.name ?? undefined })}
            className="flex items-center gap-1 text-xs font-medium text-accent2 hover:underline"
          >
            Browse all <ArrowRight className="size-3" />
          </Link>
        </div>

        {ownPublicProjects === null ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : ownPublicProjects.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
            You haven't made any projects public yet.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {ownPublicProjects.map((p) => (
              <Link
                key={p.id}
                to={projectPath(p.slug)}
                className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/50"
              >
                <Globe className="size-4 shrink-0 text-accent2" />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(p.updated_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {isStaff && (
        <Link
          to="/admin"
          className="group mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">Admin dashboard</div>
            <div className="text-sm text-muted-foreground">
              {isAdmin ? 'Manage users and all projects' : 'Manage all projects'}
            </div>
          </div>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </Link>
      )}
    </div>
  )
}
