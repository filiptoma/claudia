import { useLayoutEffect, useMemo, useRef } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useAnnotationCtx, DRAFT_KEY } from '../../context/AnnotationContext'
import CommentThreadCard from './CommentThreadCard'
import SuggestionCard from './SuggestionCard'
import DraftCard from './DraftCard'

/**
 * Mobile short bottom sheet for the single active / creating annotation. Pushes document content up
 * via padding (the caller applies the height reported through `onHeightChange`). Dismissed only by
 * its close button — which cancels an in-progress draft, or deselects an existing annotation.
 */
export default function AnnotationFocusSheet({
  onHeightChange,
}: {
  onHeightChange: (h: number) => void
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const {
    activeKey,
    activate,
    deactivate,
    draft,
    threads,
    messagesByThread,
    suggestions,
    messagesBySuggestion,
    placements,
    projectId,
    uid,
    canEdit,
    canComment,
    actions,
    submitComment,
    submitSuggestion,
    cancelDraft,
    busy,
  } = useAnnotationCtx()

  useLayoutEffect(() => {
    if (sheetRef.current) onHeightChange(sheetRef.current.offsetHeight)
  })

  // Unresolved comments + pending suggestions in document order — the set the ◂ ▸ controls cycle
  // through. Activating a neighbour scrolls it clear of the sheet (handled by the annotation engine).
  const orderedKeys = useMemo(() => {
    const keys = [
      ...threads.filter((t) => !t.resolved).map((t) => t.id),
      ...suggestions.filter((s) => s.status === 'pending').map((s) => s.id),
    ]
    return keys.sort((a, b) => (placements[a] ?? Infinity) - (placements[b] ?? Infinity))
  }, [threads, suggestions, placements])

  if (!activeKey) return null

  const isDraft = activeKey === DRAFT_KEY
  const cycleIdx = isDraft ? -1 : orderedKeys.indexOf(activeKey)
  const canCycle = cycleIdx >= 0 && orderedKeys.length > 1
  const cycle = (delta: number) => {
    if (cycleIdx < 0) return
    const n = orderedKeys.length
    activate(orderedKeys[(cycleIdx + delta + n) % n])
  }
  const thread = !isDraft ? threads.find((t) => t.id === activeKey) : null
  const suggestion = !isDraft ? suggestions.find((s) => s.id === activeKey) : null
  if (!isDraft && !thread && !suggestion) return null

  const title = isDraft
    ? draft?.kind === 'suggestion'
      ? 'Suggest an edit'
      : 'New comment'
    : thread
    ? 'Comment'
    : 'Edit suggestion'

  const close = isDraft ? cancelDraft : deactivate

  return (
    <div
      ref={sheetRef}
      className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[50dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 justify-center pt-2 pb-1">
        <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          {canCycle && (
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                aria-label="Previous comment or suggestion"
                onClick={() => cycle(-1)}
                className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Next comment or suggestion"
                onClick={() => cycle(1)}
                className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ArrowRight className="size-5" />
              </button>
            </div>
          )}
          <span className="truncate px-1 text-sm font-semibold">{title}</span>
          {canCycle && (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {cycleIdx + 1}/{orderedKeys.length}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-5" />
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
    </div>
  )
}
