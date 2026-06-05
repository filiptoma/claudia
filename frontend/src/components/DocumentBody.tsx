import { lazy, Suspense, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDocument } from '../hooks/useTree'
import type { DocMeta } from '../hooks/useTree'
import { useIsMobile } from '../hooks/useIsMobile'
import QuerySuspense from './QuerySuspense'
import DocView from './DocView'
import type { Mode } from './ModeSwitch'

// The editor pulls in CodeMirror + every language grammar, so it's only loaded when the user
// actually enters edit/split mode — keeping the initial (read-only) bundle lean.
const Editor = lazy(() => import('./Editor'))

// Renders a single document (whether a project doc or a quick note): loads its content, then shows
// the read view or the editor depending on ?mode. Shared so both routes behave identically.
export default function DocumentBody({ meta, canEdit }: { meta: DocMeta; canEdit: boolean }) {
  const [searchParams] = useSearchParams()
  const docQuery = useDocument(meta.id)
  const isMobile = useIsMobile()
  const [liveContent, setLiveContent] = useState<string | null>(null)

  // Reset transient edit state when switching documents (adjust-state-during-render, no effect).
  const [trackedDoc, setTrackedDoc] = useState(meta.id)
  if (trackedDoc !== meta.id) {
    setTrackedDoc(meta.id)
    setLiveContent(null)
  }

  // Desktop defaults to split. Mobile: quick notes default to edit (they're for quick capture),
  // regular docs default to view. An explicit ?mode= URL param always wins on mobile.
  const urlMode = searchParams.get('mode') as Mode | null
  const mobileDefault: Mode = meta.is_quick_note ? 'edit' : 'view'
  const mode: Mode = !canEdit
    ? 'view'
    : isMobile
    ? (urlMode === 'view' ? 'view' : urlMode === 'edit' ? 'edit' : mobileDefault)
    : (urlMode ?? 'split')
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
              onContentChange={setLiveContent}
            />
          </Suspense>
        ) : (
          <div className="mx-auto max-w-205 px-8 pt-7 pb-28 max-md:px-4 max-md:pt-5">
            <DocView content={liveContent ?? docQuery.data.content} />
          </div>
        ))}
    </QuerySuspense>
  )
}
