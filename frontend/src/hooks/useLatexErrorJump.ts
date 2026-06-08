import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTree } from './useTree'
import type { DocMeta } from './useTree'
import { docSplitPath } from '../lib/paths'
import type { Folder, Project } from '../lib/types'
import type { ParsedError } from '../lib/latex/compiler'

// Click-to-line for compile diagnostics (§3.10). A ParsedError carries a memfs file path
// (`<folder.name>/<title>` or `<title>`) and a line; this hook maps that path back to a document and
// either jumps within the open editor or navigates to the owning doc and hands off the target line.
//
// Cross-document handoff: navigation remounts the editor (it's keyed by doc id), so the target line is
// stashed module-side and the freshly-mounted LatexEditor consumes it via takePendingJump(). One slot
// is enough — a click is a single intent — and it self-clears, so a stale jump can never fire later.

let pending: { docId: string; line: number } | null = null

/** Consume a pending jump for `docId` (returns its line once, then clears). Called by the editor on mount. */
export function takePendingJump(docId: string): number | null {
  if (pending && pending.docId === docId) {
    const { line } = pending
    pending = null
    return line
  }
  return null
}

// A doc's memfs path, mirroring vfs.ts's documentPath but over the tree's DocMeta (no content needed).
function memfsPath(doc: Pick<DocMeta, 'title' | 'folder_id'>, folderNameById: Map<string, string>): string {
  const title = doc.title.trim()
  const folderName = doc.folder_id ? folderNameById.get(doc.folder_id) : undefined
  return folderName ? `${folderName}/${title}` : title
}

const norm = (p: string) => p.replace(/^\.\//, '').replace(/^\/+/, '')

/**
 * Build a jump handler scoped to one project. When `currentDocId` + `jumpInCurrent` are supplied (the
 * editor case), an error in the open doc jumps in place; everything else navigates to the owning doc in
 * split mode and hands off the line. With no current doc (view mode), every resolvable error navigates.
 * Returns a stable callback; unresolvable files / null lines are silently ignored.
 */
export function useLatexErrorJump(
  project: Pick<Project, 'id' | 'slug'>,
  opts?: { currentDocId?: string; jumpInCurrent?: (line: number) => void; enabled?: boolean },
): (e: ParsedError) => void {
  const { documents, folders } = useTree()
  const navigate = useNavigate()
  const { currentDocId, jumpInCurrent, enabled } = opts ?? {}

  return useCallback(
    (e: ParsedError) => {
      if (enabled === false || e.line == null || !e.file) return
      const docs = documents.filter((d) => d.project_id === project.id)
      const projectFolders = folders.filter((f) => f.project_id === project.id)
      const folderNameById = new Map(projectFolders.map((f) => [f.id, f.name]))

      const target = norm(e.file)
      const base = target.split('/').pop()
      const doc =
        docs.find((d) => norm(memfsPath(d, folderNameById)) === target) ??
        // Fallback: the log sometimes names just the filename — match on title when unambiguous.
        (base ? docs.find((d) => d.title.trim() === base) : undefined)
      if (!doc) return

      if (doc.id === currentDocId && jumpInCurrent) {
        jumpInCurrent(e.line)
        return
      }
      pending = { docId: doc.id, line: e.line }
      navigate(docSplitPath(project.slug, doc, projectFolders as Folder[]))
    },
    [documents, folders, navigate, project.id, project.slug, currentDocId, jumpInCurrent, enabled],
  )
}
