import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDocument } from '../hooks/useTree'
import type { DocMeta } from '../hooks/useTree'
import { useIsMobile } from '../hooks/useIsMobile'
import { useAnnotationActions } from '../hooks/useAnnotations'
import QuerySuspense from './QuerySuspense'
import AnnotationLayer from './annotations/AnnotationLayer'
import { availableModesFor, resolveMode } from '../lib/docMode'

// The editor pulls in CodeMirror + every language grammar, so it's only loaded when the user
// actually enters edit/split mode — keeping the initial (read-only) bundle lean.
const Editor = lazy(() => import('./Editor'))

// Renders a single document (whether a project doc or a quick note): loads its content, then shows
// the read view or the editor depending on ?mode. Shared so both routes behave identically.
export default function DocumentBody({
  meta,
  canEdit,
  canComment = false,
}: {
  meta: DocMeta
  canEdit: boolean
  /** Can this user leave comments or suggest edits? True for commenter/editor/owner. */
  canComment?: boolean
}) {
  const [searchParams] = useSearchParams()
  const docQuery = useDocument(meta.id)
  const isMobile = useIsMobile()
  const annotationActions = useAnnotationActions(meta.id)

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
