import { useSearchParams } from 'react-router-dom'
import { useDocument } from '../../hooks/useTree'
import type { DocMeta } from '../../hooks/useTree'
import { useIsMobile } from '../../hooks/useIsMobile'
import { availableModesFor, resolveMode } from '../../lib/docMode'
import QuerySuspense from '../QuerySuspense'
import LatexEditor from './LatexEditor'
import LatexPreview from './LatexPreview'
import type { Project } from '../../lib/types'

// LaTeX counterpart to the markdown DocumentBody: maps the URL's ?mode= to the three LaTeX renderers.
// LaTeX has no commenter tier (§3.4) → canComment is always false, so available modes are exactly
// [view, split, edit] for editors and [view] for viewers.
//
//   view  → compiled PDF, read-only (its own compile + Download header)
//   edit  → source only
//   split → source + live compiled-PDF preview
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

  // View mode compiles the whole project (its main doc), so it needs no per-doc content — render it as
  // soon as the project is known. Edit/split need the doc's source, so they wait on the doc query.
  if (mode === 'view') {
    return <LatexPreview project={project} canEdit={canEdit} />
  }

  return (
    <QuerySuspense queries={[docQuery]} loadingLabel="Loading document…">
      {docQuery.data && (
        <LatexEditor
          key={docQuery.data.id}
          doc={docQuery.data}
          project={project}
          showPreview={mode === 'split'}
        />
      )}
    </QuerySuspense>
  )
}
