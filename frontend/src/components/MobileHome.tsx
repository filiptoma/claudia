import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Globe, Layers, Plus, StickyNote } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTree } from '../hooks/useTree'
import { useTreeActions } from '../hooks/useTreeActions'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { projectVisibility } from '../lib/access'
import { APP_NAME } from '../lib/brand'
import { notesPath, noteSplitPath, projectPath, publicProjectsPath } from '../lib/paths'
import { Button } from '@/components/ui/button'
import { ProjectGlyph, QuickNoteIcon, WorkspaceIcon } from './EntityIcons'
import type { Project } from '../lib/types'

export default function MobileHome() {
  const { projects, documents, members, loading } = useTree()
  const { user, uid } = useAuth()
  const actions = useTreeActions()
  const navigate = useNavigate()

  useDocumentTitle(APP_NAME)

  const memberCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of members) m.set(x.project_id, (m.get(x.project_id) ?? 0) + 1)
    return m
  }, [members])

  const workspace = uid ? projects.find((p) => p.is_workspace && p.owner === uid) ?? null : null

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

  const publicProjectCount = useMemo(
    () => projects.filter((p) => p.is_public && !p.is_workspace).length,
    [projects],
  )

  const onCreateProject = async () => {
    const p = await actions.newProject()
    if (p) navigate(projectPath(p.slug))
  }

  if (loading) return <div className="p-6 text-muted-foreground text-sm">Loading…</div>

  // Logged-out: show public projects list
  if (!user) {
    const publicProjects = [...projects.filter((p) => p.is_public && !p.is_workspace)]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 8)

    return (
      <div className="flex flex-col gap-5 px-4 py-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Notes, written in the open</h1>
          <p className="mt-1 text-sm text-muted-foreground">Explore public projects on {APP_NAME}.</p>
        </div>
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Public Projects</h2>
          {publicProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing public yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {publicProjects.map((p: Project) => {
                const vis = projectVisibility(p, memberCount.get(p.id) ?? 0)
                const count = documents.filter((d) => d.project_id === p.id).length
                return (
                  <Link
                    key={p.id}
                    to={projectPath(p.slug)}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm active:opacity-70"
                  >
                    <ProjectGlyph project={p} visibility={vis} className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{count} docs</span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>
    )
  }

  // Logged-in dashboard
  return (
    <div className="flex flex-col gap-6 px-4 py-5">
      {/* Workspace shortcuts */}
      {workspace && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">My Workspace</h2>
          <Link
            to={projectPath(workspace.slug)}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm active:opacity-70"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <WorkspaceIcon className="size-5" />
            </span>
            <span className="flex-1 text-sm font-medium">Open workspace</span>
            <ArrowRight className="size-4 text-muted-foreground" />
          </Link>
          <Link
            to={notesPath(workspace.slug)}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm active:opacity-70"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent2/15 text-accent2">
              <QuickNoteIcon className="size-5" />
            </span>
            <span className="flex-1 text-sm font-medium">Quick notes</span>
            <ArrowRight className="size-4 text-muted-foreground" />
          </Link>
          <Button
            variant="outline"
            className="justify-start gap-3 rounded-xl border-dashed py-3 h-auto"
            onClick={async () => {
              const note = await actions.newQuickNote()
              if (note) navigate(noteSplitPath(workspace.slug, note.slug))
            }}
          >
            <StickyNote className="size-4 text-accent2" />
            <span className="text-sm">New quick note</span>
          </Button>
        </section>
      )}

      {/* Projects */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projects</h2>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void onCreateProject()}>
            <Plus className="size-3.5" /> New
          </Button>
        </div>

        {myProjects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-8 text-center">
            <Layers className="size-7 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No projects yet</p>
            <Button size="sm" onClick={() => void onCreateProject()}>
              <Plus /> Create a project
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {myProjects.map((p: Project) => {
              const vis = projectVisibility(p, memberCount.get(p.id) ?? 0)
              const docCount = documents.filter((d) => d.project_id === p.id).length
              return (
                <Link
                  key={p.id}
                  to={projectPath(p.slug)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm active:opacity-70"
                >
                  <ProjectGlyph project={p} visibility={vis} className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{docCount} docs</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Public projects */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Globe className="inline size-3.5 mr-1" />
          Public Projects
        </h2>
        <Link
          to={publicProjectsPath()}
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm active:opacity-70"
        >
          <Globe className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">Browse public projects</span>
          {publicProjectCount > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">{publicProjectCount}</span>
          )}
          <ArrowRight className="size-4 text-muted-foreground" />
        </Link>
      </section>
    </div>
  )
}
