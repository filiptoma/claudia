import { type CSSProperties, type ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'

export interface SortableRenderProps {
  /** Ref for the element that moves while dragging (the card/row wrapper). */
  setNodeRef: (node: HTMLElement | null) => void
  /** ARIA attributes for the draggable — spread onto the wrapper. */
  attributes: DraggableAttributes
  /** Pointer/touch listeners that initiate a drag — spread onto the whole wrapper (non-touch) or a grip (touch). */
  listeners: DraggableSyntheticListeners
  /** The live drag transform/transition — spread onto the wrapper's style. */
  style: CSSProperties
  isDragging: boolean
}

// Thin render-prop wrapper over dnd-kit's useSortable so callers keep full control of their existing
// markup (cards, sidebar rows) and just thread the ref/listeners/style where they want them.
export default function SortableItem({
  id,
  disabled,
  children,
}: {
  id: string
  disabled?: boolean
  children: (props: SortableRenderProps) => ReactNode
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging, isSorting } = useSortable({
    id,
    disabled,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    // Animate the make-room shuffle only WHILE a drag is in progress. Once dropped, drop the transition
    // so the row snaps straight to its final slot — otherwise the leftover translate replays as the list
    // re-sorts and the row visibly slides in from the container's edge.
    transition: isSorting ? transition : undefined,
  }
  return <>{children({ setNodeRef, attributes, listeners, style, isDragging })}</>
}
