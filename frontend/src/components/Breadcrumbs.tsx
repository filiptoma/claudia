import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Home as HomeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface Crumb {
  label: string
  /** If set, the crumb is a link (and underlines on hover). The last/current crumb omits `to`. */
  to?: string
  icon?: ReactNode
  /**
   * Makes the LAST crumb an inline rename input (ignored on non-final crumbs). Renaming doesn't
   * change the slug, so the URL stays valid — only the displayed name updates after a refresh.
   * `value` is the real underlying name (may be empty for a quick note); `placeholder` falls back to
   * the crumb label. `id` keys the input so it re-seeds when navigating to a different item.
   */
  editable?: { id: string; value: string; placeholder?: string; onSubmit: (value: string) => void }
}

// Inline-editable final crumb. Styled to read as the current-page text until focused, then shows a
// subtle field. Commits on Enter/blur, reverts on Escape.
function EditableCrumb({
  value: initial,
  placeholder,
  icon,
  onSubmit,
}: {
  value: string
  placeholder?: string
  icon?: ReactNode
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(initial)

  const commit = () => {
    const next = value.trim()
    if (next && next !== initial) onSubmit(next)
    else setValue(initial)
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {icon}
      <input
        value={value}
        placeholder={placeholder}
        size={Math.max(value.length, placeholder?.length ?? 0, 3)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setValue(initial)
            e.currentTarget.blur()
          }
        }}
        onBlur={commit}
        aria-label="Rename"
        className="-mx-1 max-w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground hover:border-border focus:border-ring focus:bg-background focus:ring-[3px] focus:ring-ring/30"
      />
    </span>
  )
}

/**
 * Shared breadcrumb used by the app header on every page. Starts with a Home icon (padded for a
 * comfortable click target) linking to "/"; intermediate crumbs are links; the final crumb is the
 * current page (optionally an inline rename input).
 */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/"
            aria-label="Dashboard"
            className="-m-1 flex shrink-0 items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <HomeIcon className="size-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent>Dashboard</TooltipContent>
      </Tooltip>
      {items.map((c, i) => {
        const last = i === items.length - 1
        return (
          <Fragment key={i}>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
            {last && c.editable ? (
              <EditableCrumb
                key={c.editable.id}
                value={c.editable.value}
                placeholder={c.editable.placeholder ?? c.label}
                icon={c.icon}
                onSubmit={c.editable.onSubmit}
              />
            ) : c.to && !last ? (
              <Link
                to={c.to}
                className="flex min-w-0 items-center gap-1.5 truncate text-muted-foreground transition-colors hover:text-foreground hover:underline"
              >
                {c.icon}
                <span className="truncate">{c.label}</span>
              </Link>
            ) : (
              <span
                className={cn(
                  'flex min-w-0 items-center gap-1.5 truncate',
                  last ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {c.icon}
                <span className="truncate">{c.label}</span>
              </span>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
