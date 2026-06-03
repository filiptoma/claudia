import { useMemo } from 'react'
import { useTree } from './useTree'
import { useAuth } from '../context/AuthContext'
import type { DocMeta } from './useTree'
import type { Project } from '../lib/types'

export interface QuickNotesState {
  /** The signed-in user's workspace (quick notes always live here), or null when logged out. */
  workspace: Project | null
  /** All of the user's quick notes, most-recently-edited first. */
  notes: DocMeta[]
  /** Resolve a quick note by its slug (the /notes/:id segment). */
  findNote: (slug: string | undefined) => DocMeta | null
}

// Quick notes are the workspace's titleless, flag-marked documents. This centralizes resolving them
// (sidebar preview, /notes list, /notes/:id detail) so the ordering and ownership rules stay in one
// place. Sorted by updated_at desc so "latest edited" is consistent everywhere.
export function useQuickNotes(): QuickNotesState {
  const { projects, documents } = useTree()
  const { uid } = useAuth()

  const workspace = uid ? projects.find((p) => p.is_workspace && p.owner === uid) ?? null : null

  const notes = useMemo(() => {
    if (!workspace) return []
    return documents
      .filter((d) => d.project_id === workspace.id && d.is_quick_note)
      .slice()
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  }, [documents, workspace])

  const findNote = (slug: string | undefined) =>
    slug ? notes.find((n) => n.slug === slug) ?? null : null

  return { workspace, notes, findNote }
}
