import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import ActionsMenu from './ActionsMenu'
import type { MenuAction } from './ActionsMenu'

// A clickable card used across the dashboard, project, folder, and workspace pages.
//
// The whole card is a single hover group: the lift transform lives on the OUTER wrapper, so the
// absolutely-positioned action menu rides along with the card instead of staying put, and moving
// the cursor onto the menu keeps the group hovered (the card no longer drops on menu hover).
export default function ItemCard({
  icon,
  title,
  titleAccessory,
  meta,
  onOpen,
  menu = [],
  className,
}: {
  icon: ReactNode
  title: string
  /** Small node rendered after the title (e.g. a privacy lock). */
  titleAccessory?: ReactNode
  meta?: ReactNode
  onOpen: () => void
  menu?: MenuAction[]
  className?: string
}) {
  const hasMenu = menu.length > 0
  return (
    <div
      className={cn(
        'group relative rounded-xl transition-transform duration-150 hover:-translate-y-0.5',
        className,
      )}
    >
      <button
        onClick={onOpen}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors',
          'group-hover:border-primary/50 group-hover:shadow-md',
          'focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
          hasMenu && 'pr-12',
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-foreground [&_svg]:size-5">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
            {titleAccessory}
          </span>
          {meta != null && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{meta}</span>
          )}
        </span>
      </button>
      {hasMenu && (
        <div className="absolute top-1/2 right-2 -translate-y-1/2">
          <ActionsMenu actions={menu} />
        </div>
      )}
    </div>
  )
}
