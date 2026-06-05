import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Bug, Globe, Layers, Lightbulb, Lock, Plus, StickyNote } from 'lucide-react'
import { useTree } from '../hooks/useTree'
import { useAuth } from '../context/AuthContext'
import { useTreeActions } from '../hooks/useTreeActions'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useIsMobile } from '../hooks/useIsMobile'
import { projectVisibility } from '../lib/access'
import { APP_NAME } from '../lib/brand'
import { noteSplitPath, projectPath, publicProjectsPath } from '../lib/paths'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import ProjectCard from './ProjectCard'
import EmptyState from './EmptyState'
import PageLayout from './PageLayout'
import ViewAllCard from './ViewAllCard'
import MobileHome from './MobileHome'
import { ProjectGlyph, WorkspaceIcon } from './EntityIcons'
import type { Project } from '../lib/types'

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'

function FeedbackCta() {
  return (
    <section className="mt-12 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Help us improve</h2>
      <p className="mt-3 text-sm text-muted-foreground">
        Found something broken? Have an idea?{' '}
        <Link to="/bug" className="inline-flex items-center gap-1 font-medium text-destructive hover:underline">
          <Bug className="size-3.5" /> Report a bug
        </Link>
        {' '}or{' '}
        <Link to="/request" className="inline-flex items-center gap-1 font-medium text-accent2 hover:underline">
          <Lightbulb className="size-3.5" /> Request a feature
        </Link>
        .
      </p>
    </section>
  )
}

export default function Home() {
  const { projects, documents, members, loading } = useTree()
  const { user, uid, isStaff } = useAuth()
  const actions = useTreeActions()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  useDocumentTitle(APP_NAME)

  const memberCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of members) m.set(x.project_id, (m.get(x.project_id) ?? 0) + 1)
    return m
  }, [members])

  const workspace = uid ? projects.find((p) => p.is_workspace && p.owner === uid) ?? null : null

  // Authed users see the projects they own or collaborate on; logged-out visitors see public ones.
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

  // All public projects for the discovery section — sorted by latest updated, capped at 5.
  const publicProjects = useMemo(() => {
    if (!uid) return []
    return projects
      .filter((p) => p.is_public && !p.is_workspace)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 5)
  }, [projects, uid])

  const onCreateProject = async () => {
    const p = await actions.newProject()
    if (p) navigate(projectPath(p.slug))
  }
  const onQuickNote = async () => {
    const note = await actions.newQuickNote()
    if (note && workspace) navigate(noteSplitPath(workspace.slug, note.slug))
  }

  // Mobile gets its own focused layout — no grids, no feedback CTA, just the core sections.
  if (isMobile) return <MobileHome />

  if (loading) return <div className="p-10 text-muted-foreground">Loading…</div>

  // ----- logged-out landing -----
  if (!user) {
    const preview = [...myProjects]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 5)

    return (
      <PageLayout>
        <header className="border-b border-border pb-8">
          <h1 className="text-[2.5rem] font-bold tracking-tight text-balance">Notes, written in the open</h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Explore the public markdown projects shared on {APP_NAME}.
          </p>
        </header>

        {myProjects.length === 0 ? (
          <EmptyState
            className="mt-16"
            accent="muted"
            icon={<Globe />}
            title="Nothing public yet"
            hint="There are no public projects to explore right now."
          />
        ) : (
          <>
            <div className={`${GRID} mt-8`}>
              {preview.map((p: Project) => {
                const count = documents.filter((d) => d.project_id === p.id).length
                const visibility = projectVisibility(p, memberCount.get(p.id) ?? 0)
                return (
                  <ProjectCard
                    key={p.id}
                    icon={<ProjectGlyph project={p} visibility={visibility} />}
                    title={p.name}
                    meta={`${count} ${count === 1 ? 'document' : 'documents'}`}
                    to={projectPath(p.slug)}
                  />
                )
              })}
              <ViewAllCard to={publicProjectsPath()} label="Browse all public projects" />
            </div>
          </>
        )}
        <FeedbackCta />
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <div className="mb-6 max-md:mb-4">
        <h1 className="text-2xl font-bold tracking-tight max-md:text-xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">A clean, shared place for your markdown notes.</p>
      </div>

      {workspace && (
        <section className="mb-8 max-md:mb-6">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">My Workspace</h2>
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
            {user && myProjects.length > 0 && (
              <Button size="sm" onClick={() => void onCreateProject()}>
                <Plus /> New project
              </Button>
            )}
          </div>
        </div>

        {myProjects.length === 0 ? (
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
          <div className={GRID}>
            {myProjects.map((p: Project) => {
              const count = documents.filter((d) => d.project_id === p.id).length
              const visibility = projectVisibility(p, memberCount.get(p.id) ?? 0)
              return (
                <ProjectCard
                  key={p.id}
                  icon={<ProjectGlyph project={p} visibility={visibility} />}
                  title={p.name}
                  titleAccessory={
                    visibility === 'private' ? <Lock className="size-3 shrink-0 text-muted-foreground/70" /> : undefined
                  }
                  meta={`${count} ${count === 1 ? 'document' : 'documents'}`}
                  to={projectPath(p.slug)}
                />
              )
            })}
          </div>
        )}
      </section>

      {/* Public projects discovery — always visible for authenticated users */}
      <section className="mt-8 max-md:mt-6">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase flex items-center gap-1.5">
          <Globe className="size-3.5" /> Public Projects
        </h2>
        <div className={GRID}>
          {publicProjects.map((p: Project) => {
            const visibility = projectVisibility(p, memberCount.get(p.id) ?? 0)
            return (
              <ProjectCard
                key={p.id}
                icon={<ProjectGlyph project={p} visibility={visibility} />}
                title={p.name}
                meta={new Date(p.updated_at).toLocaleDateString()}
                to={projectPath(p.slug)}
              />
            )
          })}
          <ViewAllCard to={publicProjectsPath()} label="Browse all public projects" />
        </div>
      </section>

      <FeedbackCta />
    </PageLayout>
  )
}
