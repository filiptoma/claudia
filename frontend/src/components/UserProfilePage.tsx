import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { projectPath, publicProjectsPath } from '../lib/paths'
import { AvatarCircle } from './ProfileAvatar'
import ProjectCard from './ProjectCard'
import PageLayout from './PageLayout'
import SectionHeader from './SectionHeader'
import { Button } from '@/components/ui/button'
import type { ProjectType, PublicProfileSummary, PublicProject } from '../lib/types'
import { APP_NAME } from '../lib/brand'

export default function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()

  const [profile, setProfile] = useState<PublicProfileSummary | null | 'loading'>('loading')
  const [projects, setProjects] = useState<PublicProject[] | null>(null)

  useDocumentTitle(
    profile && profile !== 'loading' ? `${profile.name ?? 'User'} · ${APP_NAME}` : APP_NAME,
  )

  useEffect(() => {
    if (!userId) return
    let active = true

    async function load() {
      if (!userId) return
      // Fetch profile by ID — returns data regardless of public project count so we can
      // distinguish "user not found" from "user exists but has no public projects yet".
      const { data: profileData } = await supabase.rpc('get_profile_by_id', { p_user: userId })
      const p = (
        profileData as { id: string; name: string | null; avatar_url: string | null }[] | null
      )?.[0] ?? null
      if (!active) return
      setProfile(p)

      if (!p) return

      // Fetch their public projects
      const { data: projData } = await supabase
        .from('projects')
        .select('id, name, slug, type, owner, created_at, updated_at')
        .eq('owner', userId)
        .eq('is_public', true)
        .eq('is_workspace', false)
        .order('updated_at', { ascending: false })
      if (!active) return
      setProjects(
        ((projData as { id: string; name: string; slug: string; type: ProjectType; owner: string; created_at: string; updated_at: string }[]) ?? []).map((pr) => ({
          ...pr,
          owner_name: p.name,
          owner_avatar_url: p.avatar_url,
          document_count: 0,
        })),
      )
    }

    void load()
    return () => { active = false }
  }, [userId])

  if (!userId) {
    navigate('/')
    return null
  }

  if (profile === 'loading') {
    return <div className="p-10 text-muted-foreground">Loading…</div>
  }

  if (!profile) {
    return (
      <div className="mx-auto mt-[10vh] flex max-w-md flex-col items-center gap-4 px-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
          <Layers className="size-7 text-muted-foreground" />
        </span>
        <h1 className="text-xl font-semibold">Profile not found</h1>
        <p className="text-sm text-muted-foreground">
          This user doesn't exist.
        </p>
        <Button variant="outline" asChild>
          <Link to="/">Go home</Link>
        </Button>
      </div>
    )
  }

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

  return (
    <PageLayout variant="medium">
      {/* Profile header */}
      <div className="mb-8 flex items-center gap-4">
        <AvatarCircle
          userId={profile.id}
          name={profile.name}
          email={null}
          avatarUrl={profile.avatar_url}
          size="lg"
        />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{profile.name ?? 'Unnamed user'}</h1>
          <p className="text-sm text-muted-foreground">Public profile</p>
        </div>
      </div>

      {/* Public projects */}
      <section>
        <SectionHeader
          title="Public projects"
          to={publicProjectsPath({ owner: profile.name ?? undefined })}
          actionLabel="See all"
        />

        {!projects ? (
          <div className="text-sm text-muted-foreground">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No public projects yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                icon={<BookOpen className="size-5" />}
                title={p.name}
                projectType={p.type}
                meta={`Updated ${fmtDate(p.updated_at)}`}
                to={projectPath(p.slug)}
              />
            ))}
          </div>
        )}
      </section>
    </PageLayout>
  )
}
