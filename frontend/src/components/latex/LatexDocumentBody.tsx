import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDocument } from '../../hooks/useTree'
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
  const mode = resolveMode(searchParams.get('mode'), availableModesFor(canEdit, false, isMobile))

  // The editor registers its live (unsaved) buffer here so a compile overlays the latest keystrokes;
  // in view mode there's no editor and this stays null, so the compile uses saved content.
  const overrideRef = useRef<GetOverride | null>(null)
  const compile = useLatexCompile(project, () => overrideRef.current?.() ?? null)
  const runCompile = compile.compile

  // Kick off exactly one compile the first time a preview-bearing mode (view or split) is shown; later
  // mode switches find the cached result and don't recompile. Split uses a fast draft; the Compile /
  // Recompile button promotes it to a full build. Pure edit mode needs no PDF, so it waits until the
  // user opens a preview.
  const kicked = useRef(false)
  useEffect(() => {
    if (kicked.current || (mode !== 'view' && mode !== 'split')) return
    kicked.current = true
    runCompile({ draft: mode === 'split' })
  }, [mode, runCompile])

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
