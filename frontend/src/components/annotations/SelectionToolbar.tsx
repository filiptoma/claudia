import { useLayoutEffect, useRef, useState } from 'react'
import { MessageSquarePlus, PencilLine } from 'lucide-react'

// Floating "Comment" / "Suggest edit" affordance shown just above the current text selection. The
// caller only renders it when captureSelection succeeded, so the actions always have a valid target.
export default function SelectionToolbar({
  rect,
  canEdit,
  onComment,
  onSuggest,
}: {
  rect: DOMRect
  canEdit: boolean
  onComment: () => void
  onSuggest: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: rect.left, top: rect.top })

  // Center over the selection, above it; clamp into the viewport. Measured after mount so width is real.
  useLayoutEffect(() => {
    const el = ref.current
    const w = el?.offsetWidth ?? 160
    const h = el?.offsetHeight ?? 36
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8)
    const above = rect.top - h - 8
    const top = above > 8 ? above : rect.bottom + 8
    setPos({ left, top })
  }, [rect])

  return (
    <div
      ref={ref}
      // Stop mousedown from collapsing the selection before the click handler fires.
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 text-popover-foreground shadow-lg"
      style={{ left: pos.left, top: pos.top }}
    >
      <button
        type="button"
        onClick={onComment}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
      >
        <MessageSquarePlus className="size-4 text-muted-foreground" />
        Comment
      </button>
      {!canEdit && (
        <button
          type="button"
          onClick={onSuggest}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <PencilLine className="size-4 text-muted-foreground" />
          Suggest edit
        </button>
      )}
    </div>
  )
}
