import { useEffect, useRef } from 'react'
import { CornerDownLeft, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SlashCommand {
  id: string
  label: string
  sub: string
}

export interface SlashState {
  /** Document offset of the triggering `/`. */
  from: number
  query: string
  coords: { left: number; top: number; bottom: number }
  items: SlashCommand[]
}

// Stage 1 of the slash flow: a passive command menu rendered at the caret. Focus stays in CodeMirror
// — the typed `/query` lives in the document and the editor's keymap drives selection. Choosing a
// command removes the `/query` text and opens the focused reference picker (stages 2–3).
export default function SlashMenu({
  state,
  active,
  onHover,
  onPick,
}: {
  state: SlashState
  active: number
  onHover: (index: number) => void
  onPick: (index: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const { items, coords } = state

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const below = coords.bottom + 280 < window.innerHeight
  const style = below
    ? { left: coords.left, top: coords.bottom + 6 }
    : { left: coords.left, bottom: window.innerHeight - coords.top + 6 }

  return (
    <div
      className="fixed z-50 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      style={style}
    >
      <div className="px-2.5 pt-2 pb-0.5 text-[0.66rem] font-semibold tracking-wide text-muted-foreground uppercase">
        Commands
      </div>
      <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
        {items.map((it, i) => (
          <button
            key={it.id}
            data-idx={i}
            type="button"
            // Keep focus in the editor so the typed text + caret stay put.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(i)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
              i === active ? 'bg-accent text-accent-foreground' : 'text-foreground',
            )}
          >
            <Link2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{it.label}</span>
              <span className="truncate text-xs text-muted-foreground">{it.sub}</span>
            </span>
            {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
          </button>
        ))}
      </div>
    </div>
  )
}
