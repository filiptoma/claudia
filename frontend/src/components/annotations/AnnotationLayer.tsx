import { useRef } from 'react'
import { AnnotationContext } from '../../context/AnnotationContext'
import { useAnnotationEngine } from '../../hooks/useAnnotationEngine'
import DocView from '../DocView'
import AnnotationToolbar from './AnnotationToolbar'
import MarginIndicatorGroup from './MarginIndicator'

// Desktop floating window sits below the app header (h-13 = 52px) + the sticky rendered-markdown
// toolbar (h-11 = 44px).
const VIEW_FLOATING_TOP = 104

/**
 * Read-mode document with the full annotations UX:
 *  - a toolbar pinned to the top of the view holding the comments/suggestions sidebar button
 *  - inline highlights for anchored comments & suggestions (CSS Custom Highlight API)
 *  - margin indicator dots (desktop) at each anchor's y-position
 *  - desktop floating window / mobile focus sheet for the single active or in-progress annotation
 *  - a floating Comment / Suggest toolbar while text is selected
 */
export default function AnnotationLayer({
  docId,
  projectId,
  content,
  canEdit,
  canComment = false,
}: {
  docId: string
  projectId: string
  content: string
  canEdit: boolean
  canComment?: boolean
}) {
  const docRef = useRef<HTMLDivElement>(null)
  const eng = useAnnotationEngine({
    docRef,
    docId,
    projectId,
    content,
    canEdit,
    canComment,
    floatingTop: VIEW_FLOATING_TOP,
  })

  // The comments/suggestions button only makes sense when the user can comment or there's something
  // to read; the toolbar itself always shows so the copy-markdown button is available to everyone.
  const showComments = canComment || eng.hasAnnotations

  // Bottom padding: when the touch focus sheet (short bottom sheet) is active, push content above it.
  const docPaddingBottom =
    eng.focusMode === 'sheet' && eng.activeKey && eng.focusSheetHeight > 0
      ? `${eng.focusSheetHeight + 24}px`
      : undefined

  return (
    <AnnotationContext.Provider value={eng.ctx}>
      {/* Toolbar sits OUTSIDE the scroll area (fixed, always visible — mirroring the split editor's
          preview toolbar), so it never scrolls away. The document scrolls in the inner container below;
          the annotation engine binds to it via getScrollParent. */}
      <div className="flex h-full min-h-0 flex-col">
        <AnnotationToolbar
          count={eng.pendingCount}
          onOpenSidebar={() => eng.ctx.setSidebarOpen(true)}
          content={content}
          showComments={showComments}
          autoHide={false}
        />

        <div className="relative min-h-0 w-full flex-1 overflow-y-auto">
          <div
            className="mx-auto max-w-205 px-8 pt-7 pb-24 max-md:px-4 max-md:pt-5"
            style={docPaddingBottom ? { paddingBottom: docPaddingBottom } : undefined}
          >
            <div className="relative overflow-visible">
              <div ref={docRef} onClick={eng.onDocClick}>
                <DocView content={content} annotate suggestions={eng.suggestionDiffs} />
              </div>

              {eng.listMode === 'sidebar' &&
                eng.marginGroups.map((group) => (
                  <MarginIndicatorGroup
                    key={group.items.map((i) => i.key).join(',')}
                    top={group.top}
                    items={group.items}
                    onActivate={eng.activate}
                  />
                ))}
            </div>
          </div>
        </div>
      </div>

      {eng.overlays}
    </AnnotationContext.Provider>
  )
}
