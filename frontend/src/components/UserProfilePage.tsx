import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Globe, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { projectPath, publicProjectsPath } from '../lib/paths'
import ProfileAvatar from './ProfileAvatar'
import { Button } from '@/components/ui/button'
import type { PublicProfileSummary, PublicProject } from '../lib/types'
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
      // Fetch public profile via RPC (safe — only returns if user has public projects)
      const { data: profileData } = await supabase.rpc('get_public_profile', { p_user: userId })
      const p = (
        profileData as { id: string; name: string | null; avatar_url: string | null }[] | null
      )?.[0] ?? null
      if (!active) return
      setProfile(p)

      if (!p) return

      // Fetch their public projects
      const { data: projData } = await supabase
        .from('projects')
        .select('id, name, slug, owner, created_at, updated_at')
        .eq('owner', userId)
        .eq('is_public', true)
        .eq('is_workspace', false)
        .order('updated_at', { ascending: false })
      if (!active) return
      setProjects(
        ((projData as { id: string; name: string; slug: string; owner: string; created_at: string; updated_at: string }[]) ?? []).map((pr) => ({
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
          This user doesn't exist or hasn't published any projects yet.
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
    <div className="mx-auto max-w-4xl px-8 pt-10 pb-24 max-md:px-5 max-md:pt-14">
      {/* Profile header */}
      <div className="mb-8 flex items-center gap-4">
        <ProfileAvatar
          userId={profile.id}
          name={profile.name}
          email={null}
          avatarUrl={profile.avatar_url}
          variant="tooltip"
          size="lg"
        />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{profile.name ?? 'Unnamed user'}</h1>
          <p className="text-sm text-muted-foreground">Public profile</p>
        </div>
      </div>

      {/* Public projects */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Public projects
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to={publicProjectsPath({ owner: profile.name ?? undefined })}>
              See all
            </Link>
          </Button>
        </div>

        {!projects ? (
          <div className="text-sm text-muted-foreground">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No public projects yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(projectPath(p.slug))}
                className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent2/12 text-accent2">
                  <Globe className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <div className="font-medium leading-snug line-clamp-2 transition-colors group-hover:text-primary">
                    {p.name}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Updated {fmtDate(p.updated_at)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
