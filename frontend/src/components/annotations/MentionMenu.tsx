import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AvatarCircle } from '../ProfileAvatar'
import { cn } from '@/lib/utils'
import type { MentionableUser } from '../../lib/types'

const MAX_H = 224 // max-h-56

// @-typeahead list. Rendered in a portal with fixed positioning anchored to the textarea, so it
// escapes the floating window's / card's overflow clipping and stacks above them. Presentational:
// the Composer owns the active index and key handling (focus stays in the textarea), like SlashMenu.
export default function MentionMenu({
  users,
  active,
  anchorEl,
  onHover,
  onPick,
}: {
  users: MentionableUser[]
  active: number
  anchorEl: HTMLElement | null
  onHover: (index: number) => void
  onPick: (user: MentionableUser) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchorEl) return
    const update = () => {
      const r = anchorEl.getBoundingClientRect()
      const estimated = Math.min(users.length * 44 + 8, MAX_H)
      // Flip above the textarea when there isn't room below.
      const below = r.bottom + 4
      const top = below + estimated > window.innerHeight && r.top - 4 - estimated > 0 ? r.top - 4 - estimated : below
      setPos({ left: r.left, top, width: r.width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchorEl, users.length])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (users.length === 0 || !pos) return null

  return createPortal(
    <div
      ref={listRef}
      className="fixed z-100 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ left: pos.left, top: pos.top, width: pos.width }}
    >
      {users.map((u, i) => (
        <button
          key={u.id}
          data-idx={i}
          type="button"
          // Keep focus in the textarea so the caret/value stay put.
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(u)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
            i === active ? 'bg-accent text-accent-foreground' : 'text-foreground',
          )}
        >
          <AvatarCircle userId={u.id} name={u.name} email={u.email} avatarUrl={u.avatar_url} size="sm" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm">{u.name || u.email || 'Unknown user'}</span>
            {u.name && u.email && <span className="truncate text-xs text-muted-foreground">{u.email}</span>}
          </span>
          <span className="shrink-0 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
            {u.member_role}
          </span>
        </button>
      ))}
    </div>,
    document.body,
  )
}
