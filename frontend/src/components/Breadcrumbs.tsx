import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Home as HomeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '../context/AuthContext'
import { useIsMobile } from '../hooks/useIsMobile'

export interface Crumb {
  label: string
  to?: string
  icon?: ReactNode
  editable?: { id: string; value: string; placeholder?: string; onSubmit: (value: string) => void }
}

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

function HomeLink({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/"
          aria-label={label}
          className="-m-1 flex shrink-0 items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <HomeIcon className="size-4" />
        </Link>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Shared breadcrumb used by the app header on every page.
 *
 * Desktop: full inline chain starting with a Home icon.
 * Mobile (multi-item): the current crumb becomes a tap-to-expand DropdownMenu trigger showing
 * the full ancestor chain. No home icon — users tap the logo to go home. No animation.
 */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  const { uid } = useAuth()
  const isMobile = useIsMobile()
  const homeLabel = uid ? 'Dashboard' : 'Home'

  // Mobile with multiple crumbs: compact dropdown, no home icon.
  if (isMobile && items.length > 1) {
    const last = items[items.length - 1]
    const lastLabel = last.editable
      ? (last.editable.value || last.editable.placeholder || last.label)
      : last.label

    return (
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'flex min-w-0 items-center gap-1 truncate font-semibold text-foreground',
              'focus-visible:outline-none',
            )}
          >
            {last.icon && <span className="shrink-0 text-muted-foreground">{last.icon}</span>}
            <span className="truncate">{lastLabel}</span>
            <ChevronDown className="ml-0.5 size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          {/* data-[state=open]:!animate-none disables the enter animation for an instant feel. */}
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="min-w-44 max-w-64 data-[state=open]:animate-none!"
          >
            {items.map((c, i) => {
              const isLast = i === items.length - 1
              const label = c.editable
                ? (c.editable.value || c.editable.placeholder || c.label)
                : c.label
              return c.to && !isLast ? (
                <DropdownMenuItem key={i} asChild>
                  <Link to={c.to} className="flex items-center gap-2 py-2.5">
                    {c.icon && <span className="shrink-0">{c.icon}</span>}
                    <span className="truncate">{label}</span>
                  </Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={i} disabled className="py-2.5 font-medium opacity-100">
                  {c.icon && <span className="shrink-0">{c.icon}</span>}
                  <span className="truncate">{label}</span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    )
  }

  // Mobile single item: just the label, no home icon.
  if (isMobile) {
    const c = items[0]
    return (
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 truncate font-semibold text-foreground">
          {c.icon && <span className="shrink-0 text-muted-foreground">{c.icon}</span>}
          <span className="truncate">{c.label}</span>
        </span>
      </nav>
    )
  }

  // Desktop: full inline chain starting with home icon.
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      <HomeLink label={homeLabel} />
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
