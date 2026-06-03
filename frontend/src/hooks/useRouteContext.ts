import { useParams } from 'react-router-dom'
import { useTree } from './useTree'
import { useAuth } from '../context/AuthContext'
import type { DocMeta } from './useTree'
import type { Folder, Project } from '../lib/types'

export interface RouteContext {
  projectSlug?: string
  /** The user's private workspace project (always present once the tree has loaded for a user). */
  workspace: Project | null
  /** Project addressed by the URL (null on /, /profile, etc.). */
  project: Project | null
  /** Folder addressed by the URL within the current project (the listing context, if any). */
  folder: Folder | null
  /** Document addressed by the URL (a root doc, or a doc inside `folder`). */
  doc: DocMeta | null
  /** True when the URL pointed at a folder/doc segment that didn't resolve (→ show not-found). */
  missing: boolean
  /** What the sidebar should show: the routed project, falling back to the workspace. */
  currentProject: Project | null
}

// Resolves the project / folder / document the current URL points at, from the cached tree.
//
// The path mirrors the tree:
//   /:projectSlug                       → project root
//   /:projectSlug/:seg1                 → a folder listing, OR a root-level document
//   /:projectSlug/:seg1/:seg2           → :seg1 is the folder, :seg2 the document inside it
export function useRouteContext(): RouteContext {
  const { projectSlug, seg1, seg2 } = useParams()
  const { projects, folders, documents } = useTree()
  const { uid } = useAuth()

  const workspace = projects.find((p) => p.is_workspace && p.owner === uid) ?? null
  // Slugs are unique per owner, so staff (who can see every user's workspace, all slugged "my")
  // could match someone else's. Prefer a project that's mine or not a workspace before any match.
  const project = projectSlug
    ? projects.find((p) => p.slug === projectSlug && (p.owner === uid || !p.is_workspace)) ??
      projects.find((p) => p.slug === projectSlug) ??
      null
    : null

  let folder: Folder | null = null
  let doc: DocMeta | null = null
  let missing = false

  if (project) {
    if (seg2 !== undefined) {
      // /:project/:folder/:doc — both segments must resolve, in order.
      folder = folders.find((f) => f.project_id === project.id && f.slug === seg1) ?? null
      doc = folder
        ? documents.find((d) => d.folder_id === folder!.id && d.slug === seg2) ?? null
        : null
      if (!folder || !doc) missing = true
    } else if (seg1 !== undefined) {
      // /:project/:seg1 — a folder if one matches, otherwise a root-level document. Quick notes are
      // excluded: they live under /notes/:id, not the project's URL space.
      folder = folders.find((f) => f.project_id === project.id && f.slug === seg1) ?? null
      if (!folder) {
        doc =
          documents.find(
            (d) => d.project_id === project.id && !d.folder_id && !d.is_quick_note && d.slug === seg1,
          ) ?? null
        if (!doc) missing = true
      }
    }
  }

  return {
    projectSlug,
    workspace,
    project,
    folder,
    doc,
    missing,
    currentProject: project ?? workspace,
  }
}
