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
  accent = 'default',
  className,
}: {
  icon: ReactNode
  title: string
  /** Small node rendered after the title (e.g. a privacy lock). */
  titleAccessory?: ReactNode
  meta?: ReactNode
  onOpen: () => void
  menu?: MenuAction[]
  /** Icon-chip tint. 'indigo' marks the quick-note identity; everything else uses the warm default. */
  accent?: 'default' | 'indigo'
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
          'flex h-full w-full items-center gap-3.5 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors',
          'group-hover:border-primary/50 group-hover:shadow-md',
          'focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
          hasMenu && 'pr-12',
        )}
      >
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors [&_svg]:size-5',
            accent === 'indigo'
              ? 'bg-accent2/12 text-accent2 group-hover:bg-accent2/20'
              : 'bg-muted text-muted-foreground group-hover:bg-primary/15 group-hover:text-foreground',
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1.5">
            <span className="min-w-0 flex-1 font-medium leading-snug line-clamp-2">{title}</span>
            {titleAccessory && <span className="mt-0.5 shrink-0">{titleAccessory}</span>}
          </span>
          {meta != null && (
            <span className="mt-1 block truncate text-xs text-muted-foreground">{meta}</span>
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
