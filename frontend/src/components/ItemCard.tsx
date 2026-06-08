import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import ActionsMenu from './ActionsMenu'
import type { MenuAction } from './ActionsMenu'

// A navigable card used across the dashboard, project, folder, and workspace pages.
//
// Uses the "stretched link" pattern: a <Link> is absolutely positioned over the card
// content. Action menu buttons sit above it (z-[1]) so they remain independently
// clickable. This makes the entire card surface an accessible anchor while keeping
// nested interactive elements valid HTML.
export default function ItemCard({
  icon,
  title,
  titleAccessory,
  meta,
  to,
  menu = [],
  accent = 'default',
  className,
}: {
  icon: ReactNode
  title: string
  /** Small node rendered after the title (e.g. a privacy lock). */
  titleAccessory?: ReactNode
  meta?: ReactNode
  to: string
  menu?: MenuAction[]
  /** Icon-chip tint. 'indigo' = quick notes, 'blue' = public projects, default = warm muted. */
  accent?: 'default' | 'indigo' | 'blue'
  className?: string
}) {
  const hasMenu = menu.length > 0
  return (
    <div
      className={cn(
        // transform-gpu keeps the whole card on one compositing layer so its text translates smoothly
        // with the frame on hover (otherwise the title re-rasterizes each frame and appears to lag).
        'group relative transform-gpu rounded-xl transition-transform duration-150 ease-out hover:-translate-y-0.5',
        className,
      )}
    >
      {/* Visible card content */}
      <div
        className={cn(
          'flex h-full w-full items-center gap-3.5 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors',
          'group-hover:border-primary/50 group-hover:shadow-md',
          'group-focus-within:border-primary/50 group-focus-within:shadow-md',
          hasMenu && 'pr-12',
        )}
      >
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors [&_svg]:size-5',
            accent === 'indigo'
              ? 'bg-accent2/12 text-accent2 group-hover:bg-accent2/20'
              : accent === 'blue'
              ? 'bg-blue-100/70 group-hover:bg-blue-100 dark:bg-blue-400/10 dark:group-hover:bg-blue-400/18'
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
      </div>

      {/* Stretched anchor covers the whole card. Rendered after content so it sits
          on top in the stacking context and intercepts pointer events for navigation. */}
      <Link
        to={to}
        className={cn(
          'absolute inset-0 rounded-xl',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        )}
        tabIndex={0}
      >
        <span className="sr-only">{title}</span>
      </Link>

      {/* Action menu floats above the stretched link */}
      {hasMenu && (
        <div className="absolute top-1/2 right-2 -translate-y-1/2 z-1">
          <ActionsMenu actions={menu} />
        </div>
      )}
    </div>
  )
}
