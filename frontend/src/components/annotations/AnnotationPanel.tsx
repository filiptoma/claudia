import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PanelEntry {
  key: string
  /** Vertical offset of the anchor within the rail's coordinate space; null when orphaned. */
  anchorTop: number | null
  node: ReactNode
}

const GAP = 12 // px between stacked cards

// Renders annotation cards either as an anchor-aligned right rail (wide screens) with downward
// collision avoidance, or as a slide-in drawer (narrow screens). Card heights are measured so the
// active card can expand without overlapping its neighbours.
export default function AnnotationPanel({
  variant,
  entries,
  header,
  open = true,
  onClose,
}: {
  variant: 'rail' | 'drawer'
  entries: PanelEntry[]
  header?: ReactNode
  open?: boolean
  onClose?: () => void
}) {
  const wrapRefs = useRef(new Map<string, HTMLDivElement>())

  // Position cards imperatively (sync to the DOM): stack each anchored card downward from its anchor
  // top, never overlapping the previous one. Re-runs on every render and whenever a card resizes
  // (the active card expanding, a textarea growing, images loading) via a ResizeObserver.
  useLayoutEffect(() => {
    if (variant !== 'rail') return
    const relayout = () => {
      const sorted = [...entries].sort((a, b) => (a.anchorTop ?? 1e9) - (b.anchorTop ?? 1e9))
      let cursor = 0
      for (const e of sorted) {
        const el = wrapRefs.current.get(e.key)
        if (!el) continue
        const top = Math.max(e.anchorTop ?? cursor, cursor)
        el.style.top = `${top}px`
        cursor = top + el.offsetHeight + GAP
      }
    }
    relayout()
    const ro = new ResizeObserver(relayout)
    for (const el of wrapRefs.current.values()) ro.observe(el)
    return () => ro.disconnect()
  }, [entries, variant])

  const setRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) wrapRefs.current.set(key, el)
    else wrapRefs.current.delete(key)
  }

  if (variant === 'rail') {
    return (
      <div className="relative w-80 shrink-0">
        {header && <div className="sticky top-0 z-10 mb-2 flex justify-end">{header}</div>}
        {entries.map((e) => (
          <div
            key={e.key}
            ref={setRef(e.key)}
            className="absolute left-0 right-0 transition-[top] duration-200 ease-out"
            style={{ top: e.anchorTop ?? 0 }}
          >
            {e.node}
          </div>
        ))}
      </div>
    )
  }

  // Drawer (narrow screens): a fixed slide-in column.
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] md:hidden" onClick={onClose} />}
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[min(22rem,90vw)] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Comments &amp; suggestions</span>
          <div className="flex items-center gap-1">
            {header}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
          {entries.length === 0 ? (
            <p className="mt-8 text-center text-sm text-muted-foreground">No comments or suggestions yet.</p>
          ) : (
            entries.map((e) => <div key={e.key}>{e.node}</div>)
          )}
        </div>
      </aside>
    </>
  )
}
