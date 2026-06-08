import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDocument, useTree } from '../../hooks/useTree'
import type { DocMeta } from '../../hooks/useTree'
import { useIsMobile } from '../../hooks/useIsMobile'
import { availableModesFor, resolveMode } from '../../lib/docMode'
import { useLatexCompile, type GetOverride } from '../../hooks/useLatexCompile'
import QuerySuspense from '../QuerySuspense'
import LatexEditor from './LatexEditor'
import LatexPreview from './LatexPreview'
import type { Project } from '../../lib/types'

// LaTeX counterpart to the markdown DocumentBody: maps the URL's ?mode= to the three LaTeX renderers.
// LaTeX has no commenter tier (§3.4) → canComment is always false, so available modes are exactly
// [view, split, edit] for editors and [view] for viewers. The default ?mode= is set by DocumentBody
// on mount (split for editors, nothing for viewers), so this component always reads an explicit param.
//
//   view  → compiled PDF, read-only (its own compile + Download header)
//   edit  → source only
//   split → source + live compiled-PDF preview
//
// The compile state is owned HERE, above the per-mode renderers, and handed to whichever one is shown.
// Switching mode is only a ?mode= change, so this component stays mounted and the compiled PDF/log
// survive the switch — toggling view/split/edit does NOT recompile the project (the expensive part).
// The host is keyed by project id (in DocumentBody), so the state still resets cleanly per project.
export default function LatexDocumentBody({
  meta,
  project,
  canEdit,
}: {
  meta: DocMeta
  project: Project
  canEdit: boolean
}) {
  const [searchParams] = useSearchParams()
  const docQuery = useDocument(meta.id)
  const isMobile = useIsMobile()
  const { documents } = useTree()
  const mode = resolveMode(searchParams.get('mode'), availableModesFor(canEdit, false, isMobile))

  // A signature of the project's content: each doc's id + updated_at. When it still matches the cached
  // PDF's signature on open, the project is unchanged → the recompile is skipped and the cached PDF is
  // reused as-is. Editing a doc bumps its updated_at (via autosave) → signature changes → a recompile runs.
  const signature = useMemo(
    () =>
      documents
        .filter((d) => d.project_id === project.id && !d.is_quick_note)
        .map((d) => `${d.id}:${d.updated_at}`)
        .sort()
        .join('|'),
    [documents, project.id],
  )

  // The editor registers its live (unsaved) buffer here so a compile overlays the latest keystrokes;
  // in view mode there's no editor and this stays null, so the compile uses saved content.
  const overrideRef = useRef<GetOverride | null>(null)
  const compile = useLatexCompile(project, () => overrideRef.current?.() ?? null, () => signature)
  const compileIfStale = compile.compileIfStale

  // Kick off exactly one compile the first time a preview-bearing mode (view or split) is shown. The
  // policy lives in compileIfStale: unchanged → reuse the cached PDF (no compile); first open → full
  // (resolve refs/citations); changed → fast draft. Full rebuilds thereafter are manual (the Compile
  // button) only. Later mode switches reuse the result; pure edit mode waits until a preview opens.
  const kicked = useRef(false)
  useEffect(() => {
    if (kicked.current || (mode !== 'view' && mode !== 'split')) return
    kicked.current = true
    compileIfStale()
  }, [mode, compileIfStale])

  // View mode compiles the whole project (its main doc), so it needs no per-doc content — render it as
  // soon as the project is known. Edit/split need the doc's source, so they wait on the doc query.
  if (mode === 'view') {
    return <LatexPreview project={project} canEdit={canEdit} compile={compile} />
  }

  return (
    <QuerySuspense queries={[docQuery]} loadingLabel="Loading document…">
      {docQuery.data && (
        <LatexEditor
          key={docQuery.data.id}
          doc={docQuery.data}
          project={project}
          showPreview={mode === 'split'}
          compile={compile}
          overrideRef={overrideRef}
        />
      )}
    </QuerySuspense>
  )
}
