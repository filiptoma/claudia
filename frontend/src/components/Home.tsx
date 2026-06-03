import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Layers, Lock, Plus, StickyNote } from 'lucide-react'
import { useTree } from '../hooks/useTree'
import { useAuth } from '../context/AuthContext'
import { useTreeActions } from '../hooks/useTreeActions'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { projectVisibility } from '../lib/access'
import { APP_NAME } from '../lib/brand'
import { noteSplitPath, projectPath } from '../lib/paths'
import { Button } from '@/components/ui/button'
import ItemCard from './ItemCard'
import { ProjectGlyph, WorkspaceIcon } from './EntityIcons'
import type { Project } from '../lib/types'

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

export default function Home() {
  const { projects, documents, members, loading } = useTree()
  const { user, uid, isStaff } = useAuth()
  const actions = useTreeActions()
  const navigate = useNavigate()

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
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-foreground">
              <WorkspaceIcon className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">My Workspace</div>
              <div className="text-sm text-muted-foreground">
                Your private space — organize notes into folders, or jot something down in seconds.
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={() => void onQuickNote()}>
                <StickyNote /> Quick note
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
          <div className="flex shrink-0 gap-2">
            {isStaff && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/admin/projects">
                  <Layers /> Manage all projects
                </Link>
              </Button>
            )}
            {user && (
              <Button size="sm" onClick={() => void onCreateProject()}>
                <Plus /> New project
              </Button>
            )}
          </div>
        </div>

        {myProjects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground">
              {user
                ? 'No projects yet — create your first to get started.'
                : 'There is no public content here yet. Sign in to see projects shared with you.'}
            </p>
            {user && (
              <Button className="mt-4" onClick={() => void onCreateProject()}>
                <Plus /> Create your first project
              </Button>
            )}
          </div>
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
    </div>
  )
}
