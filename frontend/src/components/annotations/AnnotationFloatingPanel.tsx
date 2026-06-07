import { X } from 'lucide-react'
import { useAnnotationCtx, DRAFT_KEY } from '../../context/AnnotationContext'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import CommentThreadCard from './CommentThreadCard'
import SuggestionCard from './SuggestionCard'
import DraftCard from './DraftCard'

/**
 * Desktop popover for the single active / creating annotation. Anchored to the active annotation's
 * rendered text (a Floating-UI virtual element), it opens directly below the highlight — flipping above
 * when there's no room — and stays within the document's scroll container (read-mode view area or the
 * split editor's preview pane). Dismissed only by its close button / Escape (or by selecting another
 * annotation), never by clicking elsewhere — so reading the doc behind it doesn't close it.
 */
export default function AnnotationFloatingPanel() {
  const {
    activeKey,
    deactivate,
    draft,
    threads,
    messagesByThread,
    suggestions,
    messagesBySuggestion,
    projectId,
    uid,
    canEdit,
    canComment,
    actions,
    submitComment,
    submitSuggestion,
    cancelDraft,
    busy,
    anchorRef,
    boundaryEl,
    docEl,
  } = useAnnotationCtx()

  const isDraft = activeKey === DRAFT_KEY
  const thread = !isDraft ? threads.find((t) => t.id === activeKey) : null
  const suggestion = !isDraft ? suggestions.find((s) => s.id === activeKey) : null
  const open = !!activeKey && (isDraft ? !!draft : !!thread || !!suggestion)

  const title = isDraft
    ? draft?.kind === 'suggestion'
      ? 'Suggest an edit'
      : 'New comment'
    : thread
    ? 'Comment'
    : 'Edit suggestion'

  const close = isDraft ? cancelDraft : deactivate

  return (
    <Popover open={open} onOpenChange={(o) => { if (!o) close() }}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        collisionBoundary={boundaryEl ?? undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // Keep the popover open when the interaction is (a) inside the document — handled by the doc
          // click logic (select another annotation, or dismiss) — or (b) inside a portaled overlay
          // opened from within the panel, e.g. the card's actions menu. Only truly-outside clicks close.
          const t = e.detail.originalEvent.target as Element | null
          if (t && (docEl?.contains(t) || t.closest('[data-radix-popper-content-wrapper]')))
            e.preventDefault()
        }}
        className="flex max-h-[min(500px,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-0"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">{title}</span>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isDraft && draft ? (
            <DraftCard
              kind={draft.kind}
              originalMd={draft.capture.anchor.quote}
              projectId={projectId}
              busy={busy}
              onSubmitComment={submitComment}
              onSubmitSuggestion={submitSuggestion}
              onCancel={cancelDraft}
            />
          ) : thread ? (
            <CommentThreadCard
              thread={thread}
              messages={messagesByThread.get(thread.id) ?? []}
              projectId={projectId}
              uid={uid}
              canEdit={canEdit}
              canComment={canComment}
              actions={actions}
              variant="floating"
            />
          ) : suggestion ? (
            <SuggestionCard
              suggestion={suggestion}
              messages={messagesBySuggestion.get(suggestion.id) ?? []}
              projectId={projectId}
              uid={uid}
              canEdit={canEdit}
              actions={actions}
              variant="floating"
            />
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
