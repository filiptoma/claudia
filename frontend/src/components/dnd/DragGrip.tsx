import { GripVertical } from 'lucide-react'
import type { DraggableSyntheticListeners } from '@dnd-kit/core'
import { cn } from '@/lib/utils'

// The drag handle shown on cards/rows in touch "Change order" mode. `touch-none` keeps a press-drag on
// the grip from scrolling the page (the rest of the card still scrolls), and it carries the sortable
// listeners so the press-hold starts the drag. Hidden entirely on non-touch, where the whole card drags.
export default function DragGrip({
  listeners,
  className,
}: {
  listeners: DraggableSyntheticListeners
  className?: string
}) {
  return (
    <span
      {...listeners}
      role="button"
      aria-label="Drag to reorder"
      className={cn(
        'flex touch-none cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing',
        className,
      )}
    >
      <GripVertical className="size-4.5" />
    </span>
  )
}
