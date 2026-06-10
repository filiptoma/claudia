import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, type SortingStrategy } from '@dnd-kit/sortable'

// A pointer/touch drag ends with a `click` on the item — and our cards/rows are wrapped <Link>s, so on
// drop that click would navigate instead of completing the reorder. dnd-kit doesn't suppress it (the
// click lands on the link, a child of the activator). So we arm a one-shot, capture-phase swallow that
// runs before React's handlers and cancels exactly that trailing click. Only real drags reach here, so
// normal clicks still open the item; the timeout clears the trap if the drop produced no click.
function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  window.setTimeout(() => window.removeEventListener('click', swallow, true), 100)
}

/**
 * Wraps one sortable sibling list (a folders grid, a documents list, …).
 *
 * Two order variables:
 *   `items` (prop)   – committed order from the cache. The "original position".
 *                      Only ever used to restore order when Escape cancels a drag.
 *   `working` (state) – live temp order. Reorders on every DragOver so by the time
 *                       you drop, the final position is already in `working`.
 *
 * On drop:   persist `working` and leave it untouched — no flash back to old position.
 * On cancel: `setWorking(items)` in handleCancel immediately restores the original order.
 * External `items` changes (cache refresh / error rollback): synced via effect, but ONLY
 *   when not mid-drag and ONLY when we didn't just drop (justDroppedRef guards one skip
 *   so `working` is never clobbered by a stale `items` that hasn't caught up yet).
 */
export default function Reorderable<T extends { id: string }>({
  items,
  strategy,
  enabled,
  touch,
  onReorder,
  renderItem,
  renderOverlay,
}: {
  items: T[]
  strategy: SortingStrategy
  enabled: boolean
  touch: boolean
  onReorder: (ordered: T[]) => void
  renderItem: (item: T) => ReactNode
  renderOverlay: (item: T) => ReactNode
}) {
  const [working, setWorking] = useState<T[]>(items)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Mirror the latest working order into a ref so the drop handler reads the final order (not a
  // stale closure) when it persists. Updated in an effect (never during render).
  const workingRef = useRef(working)
  useEffect(() => {
    workingRef.current = working
  }, [working])

  // After a drop, `activeId` becomes null before React Query has flushed the optimistic
  // `qc.setQueryData` update. Without a guard the sync effect below would fire and call
  // `setWorking(stale items)` — snapping the item back to its original DOM slot and then
  // animating it to the new slot as items catches up, which is exactly the bug.
  // We set this to `true` in handleEnd and clear it on the first effect run after the drop,
  // so the skip is exactly one render — subsequent items changes (error rollback, etc.) sync normally.
  const justDroppedRef = useRef(false)

  // Sync working from items when items changes externally (error rollback, background refresh).
  // Skip the first fire after a drop because working is already at the final dropped order.
  useEffect(() => {
    if (activeId == null) {
      if (justDroppedRef.current) {
        justDroppedRef.current = false
        return
      }
      setWorking(items)
    }
  }, [items, activeId])

  // Non-touch: a 5px activation distance, so a plain click still navigates and only a real drag reorders.
  // Touch: a short press-hold with jitter tolerance, so ordinary taps/scrolls are untouched.
  const pointer = useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  const sensors = useSensors(touch ? touchSensor : pointer)

  if (!enabled) return <>{items.map(renderItem)}</>

  const handleStart = ({ active }: DragStartEvent) => {
    // working is already === items (kept in sync by the effect above).
    setActiveId(String(active.id))
  }
  const handleOver = ({ active, over }: DragOverEvent) => {
    if (!over || active.id === over.id) return
    setWorking((prev) => {
      const from = prev.findIndex((i) => i.id === active.id)
      const to = prev.findIndex((i) => i.id === over.id)
      return from === -1 || to === -1 ? prev : arrayMove(prev, from, to)
    })
  }
  const handleEnd = () => {
    swallowNextClick()
    // working is the final order (updated live during drag) — persist it as-is.
    // Guard justDroppedRef so the sync effect skips resetting working when activeId clears.
    justDroppedRef.current = true
    onReorder(workingRef.current)
    setActiveId(null)
  }
  const handleCancel = () => {
    // Escape: immediately reset working to the committed order and stop the drag.
    // justDroppedRef stays false so the sync effect will fire normally if items changes later.
    swallowNextClick()
    setWorking(items)
    setActiveId(null)
  }

  const ids = working.map((i) => i.id)
  const active = working.find((i) => i.id === activeId)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleStart}
      onDragOver={handleOver}
      onDragEnd={handleEnd}
      onDragCancel={handleCancel}
    >
      <SortableContext items={ids} strategy={strategy}>
        {working.map(renderItem)}
      </SortableContext>
      <DragOverlay>{active ? renderOverlay(active) : null}</DragOverlay>
    </DndContext>
  )
}
