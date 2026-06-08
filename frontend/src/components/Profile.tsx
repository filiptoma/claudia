import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Globe, LogOut, ShieldCheck, Upload } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTree } from '../hooks/useTree'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { supabase } from '../lib/supabase'
import { uploadAvatar } from '../lib/storage'
import { projectPath, publicProjectsPath } from '../lib/paths'
import { projectVisibility } from '../lib/access'
import { toast } from '../lib/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { AvatarCircle } from './ProfileAvatar'
import ProjectCard from './ProjectCard'
import LinkCard from './LinkCard'
import { ProjectGlyph } from './EntityIcons'
import PageLayout from './PageLayout'
import PageHeader from './PageHeader'
import SectionHeader from './SectionHeader'
import type { Project } from '../lib/types'

const GRID = 'grid grid-cols-1 gap-3 md:grid-cols-2'

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
    <PageLayout variant="medium">
      <PageHeader title="Profile" />

      {/* — identity card — */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {/* avatar + name row */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change avatar"
              className="group relative block cursor-pointer rounded-full disabled:opacity-50"
            >
              <AvatarCircle
                userId={user.id}
                name={user.name}
                email={user.email}
                avatarUrl={user.avatar_url}
                size="lg"
              />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                <Upload className="size-4 text-white" />
              </span>
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
        <SectionHeader
          icon={<Globe className="size-3.5" />}
          title="My public projects"
          to={publicProjectsPath({ owner: user.name ?? undefined })}
          actionLabel="Browse all"
        />

        {ownPublicProjects === null ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : ownPublicProjects.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
            You haven't made any projects public yet.
          </div>
        ) : (
          <div className={GRID}>
            {ownPublicProjects.map((p) => (
              <ProjectCard
                key={p.id}
                icon={<ProjectGlyph project={p} visibility={projectVisibility(p, 0)} />}
                title={p.name}
                projectType={p.type}
                meta={new Date(p.updated_at).toLocaleDateString()}
                to={projectPath(p.slug)}
              />
            ))}
          </div>
        )}
      </div>

      {/* — staff section — hidden on mobile (admin dashboard is desktop-only) */}
      {isStaff && (
        <div className="mt-6 max-md:hidden">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Staff</h2>
          <LinkCard
            to="/admin"
            icon={<ShieldCheck />}
            title="Admin dashboard"
            description={isAdmin ? 'Manage users and all projects' : 'Manage all projects'}
          />
        </div>
      )}
    </PageLayout>
  )
}
