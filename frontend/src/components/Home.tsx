import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Globe, Layers, Lock, Plus, StickyNote } from 'lucide-react'
import { useTree } from '../hooks/useTree'
import { useAuth } from '../context/AuthContext'
import { useTreeActions } from '../hooks/useTreeActions'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { projectVisibility } from '../lib/access'
import { APP_NAME } from '../lib/brand'
import { noteSplitPath, projectPath } from '../lib/paths'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import ItemCard from './ItemCard'
import EmptyState from './EmptyState'
import LoginModal from './LoginModal'
import { ProjectGlyph, WorkspaceIcon } from './EntityIcons'
import type { Project } from '../lib/types'

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'

export default function Home() {
  const { projects, documents, members, loading } = useTree()
  const { user, uid, isStaff } = useAuth()
  const actions = useTreeActions()
  const navigate = useNavigate()
  const [showLogin, setShowLogin] = useState(false)

  // The home dashboard's tab shows the bare app name.
  useDocumentTitle(APP_NAME)

  const memberCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of members) m.set(x.project_id, (m.get(x.project_id) ?? 0) + 1)
    return m
  }, [members])

  const workspace = uid ? projects.find((p) => p.is_workspace && p.owner === uid) ?? null : null

  // Authed users see the projects they own or collaborate on; logged-out visitors see public ones.
  // (Staff can technically read every project, but those belong on the /admin/projects page.)
  const myProjects = useMemo(
    () =>
      uid
        ? projects.filter(
            (p) =>
              !p.is_workspace &&
              (p.owner === uid || members.some((m) => m.project_id === p.id && m.user_id === uid)),
          )
        : projects.filter((p) => p.is_public && !p.is_workspace),
    [projects, members, uid],
  )

  const onCreateProject = async () => {
    const p = await actions.newProject()
    if (p) navigate(projectPath(p.slug))
  }
  const onQuickNote = async () => {
    const note = await actions.newQuickNote()
    if (note && workspace) navigate(noteSplitPath(workspace.slug, note.slug))
  }

  if (loading) return <div className="p-10 text-muted-foreground">Loading…</div>

  return (
    <div className="mx-auto w-full max-w-7xl px-8 pt-10 pb-24 max-md:px-5 max-md:pt-14">
      <div className="mb-8">
        <h1 className="text-[2rem] font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">A clean, shared place for your markdown notes.</p>
      </div>

      {workspace && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">My Workspace</h2>
          {/* A static callout hero: card base + a subtle gold→indigo (primary→secondary) wash to set
              it apart from the plain project cards. Gradient is semi-transparent so text stays clean. */}
          <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card bg-linear-to-br from-primary/10 to-accent2/10 p-6 shadow-sm sm:flex-row sm:items-center">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm shadow-primary/25 [&_svg]:size-7">
              <WorkspaceIcon />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold tracking-tight">My Workspace</div>
              <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Your private space — organize notes into folders, or jot something down in seconds.
              </div>
            </div>
            <div className="flex shrink-0 gap-2 max-sm:flex-wrap">
              <Button variant="accent" onClick={() => void onQuickNote()}>
                <StickyNote /> New quick note
              </Button>
              <Button onClick={() => navigate(projectPath(workspace.slug))}>
                Open workspace <ArrowRight />
              </Button>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Projects</h2>
          <div className="flex shrink-0 items-center gap-2">
            {isStaff && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Manage all projects" asChild>
                    <Link to="/admin/projects">
                      <Layers />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Manage all projects</TooltipContent>
              </Tooltip>
            )}
            {/* When there are no projects the empty-state CTA below is the single call to action. */}
            {user && myProjects.length > 0 && (
              <Button size="sm" onClick={() => void onCreateProject()}>
                <Plus /> New project
              </Button>
            )}
          </div>
        </div>

        {myProjects.length === 0 ? (
          user ? (
            <EmptyState
              className="mt-8"
              icon={<Layers />}
              title="No projects yet"
              hint="Create a project to group documents into folders and share them with others."
              actions={
                <Button onClick={() => void onCreateProject()}>
                  <Plus /> Create your first project
                </Button>
              }
            />
          ) : (
            <EmptyState
              className="mt-8"
              accent="muted"
              icon={<Globe />}
              title="Nothing public yet"
              hint="There’s no public content here yet. Sign in to see the projects shared with you."
              actions={<Button onClick={() => setShowLogin(true)}>Sign in</Button>}
            />
          )
        ) : (
          <div className={GRID}>
            {myProjects.map((p: Project) => {
              const count = documents.filter((d) => d.project_id === p.id).length
              const visibility = projectVisibility(p, memberCount.get(p.id) ?? 0)
              return (
                <ItemCard
                  key={p.id}
                  icon={<ProjectGlyph project={p} visibility={visibility} />}
                  title={p.name}
                  titleAccessory={
                    visibility === 'private' ? <Lock className="size-3 shrink-0 text-muted-foreground/70" /> : undefined
                  }
                  meta={`${count} ${count === 1 ? 'document' : 'documents'}`}
                  onOpen={() => navigate(projectPath(p.slug))}
                />
              )
            })}
          </div>
        )}
      </section>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  )
}
