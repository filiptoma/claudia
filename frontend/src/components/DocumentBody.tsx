import { lazy, Suspense, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDocument } from '../hooks/useTree'
import type { DocMeta } from '../hooks/useTree'
import { useIsMobile } from '../hooks/useIsMobile'
import { useAnnotationActions } from '../hooks/useAnnotations'
import QuerySuspense from './QuerySuspense'
import AnnotationLayer from './annotations/AnnotationLayer'
import { availableModesFor, resolveMode } from '../lib/docMode'
import type { Project } from '../lib/types'

// The editor pulls in CodeMirror + every language grammar, so it's only loaded when the user
// actually enters edit/split mode — keeping the initial (read-only) bundle lean.
const Editor = lazy(() => import('./Editor'))
// LaTeX projects get a wholly separate editor/preview/compile pipeline (CodeMirror-stex + the busytex
// engine). Lazy so none of that enters the markdown path's bundle.
const LatexDocumentBody = lazy(() => import('./latex/LatexDocumentBody'))

// Renders a single document (whether a project doc or a quick note): loads its content, then shows
// the read view or the editor depending on ?mode. Shared so both routes behave identically.
export default function DocumentBody({
  meta,
  project,
  canEdit,
  canComment = false,
}: {
  meta: DocMeta
  /** Absent for quick notes (always workspace/markdown). LaTeX projects branch to their own body. */
  project?: Project
  canEdit: boolean
  /** Can this user leave comments or suggest edits? True for commenter/editor/owner. */
  canComment?: boolean
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const docQuery = useDocument(meta.id)
  const isMobile = useIsMobile()
  const annotationActions = useAnnotationActions(meta.id)

  // For markdown documents: if no ?mode= is present, auto-set the default based on permissions.
  // Editors/commenters default to split (desktop) or edit (mobile) so the URL reflects the active
  // mode. View-only users get no ?mode= at all — keeping them unaware that other modes exist.
  useEffect(() => {
    if (searchParams.get('mode') !== null) return
    if (!canEdit && !canComment) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('mode', isMobile ? 'edit' : 'split')
        return next
      },
      { replace: true },
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // LaTeX projects use an entirely separate editor/preview/compile pipeline; everything below this
  // branch is the markdown path and stays unchanged. (Quick notes have no project → markdown.)
  if (project?.type === 'latex') {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading editor…
          </div>
        }
      >
        {/* Keyed by project so the compile state (lifted into LatexDocumentBody) resets per project but
            survives mode/doc switches within one project — see its header comment. */}
        <LatexDocumentBody key={project.id} meta={meta} project={project} canEdit={canEdit} />
      </Suspense>
    )
  }

  // True for users who can comment/suggest but cannot directly edit the document.
  const isCommenterOnly = canComment && !canEdit

  // The mode is read straight from the URL's ?mode= (the single source of truth shared with the
  // header's ModeSwitch via docMode.ts), clamped to what this user/device allows and defaulting to
  // "view" when the param is absent. So a bare document link always opens in view.
  const mode = resolveMode(searchParams.get('mode'), availableModesFor(canEdit, canComment, isMobile))
  const isEdit = mode !== 'view'

  return (
    <QuerySuspense queries={[docQuery]} loadingLabel="Loading document…">
      {docQuery.data &&
        (isEdit ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading editor…
              </div>
            }
          >
            <Editor
              key={docQuery.data.id}
              doc={docQuery.data}
              showPreview={mode === 'split'}
              suggestionMode={isCommenterOnly}
              onCreateSuggestion={isCommenterOnly ? annotationActions.createSuggestion : undefined}
            />
          </Suspense>
        ) : (
          // View mode hosts inline comments & suggested edits. They anchor to the SAVED content
          // (offsets are spliced into documents.content on approve), so the annotation layer renders
          // docQuery.data.content rather than any unsaved liveContent.
          <AnnotationLayer
            docId={docQuery.data.id}
            projectId={docQuery.data.project_id}
            content={docQuery.data.content}
            canEdit={canEdit}
            canComment={canComment}
          />
        ))}
    </QuerySuspense>
  )
}
