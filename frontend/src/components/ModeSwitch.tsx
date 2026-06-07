import { Eye, Columns2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '../hooks/useIsMobile'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type Mode = 'view' | 'split' | 'edit'

const MODES: { id: Mode; label: string; Icon: typeof Eye }[] = [
  { id: 'view', label: 'View', Icon: Eye },
  { id: 'split', label: 'Split', Icon: Columns2 },
  { id: 'edit', label: 'Edit', Icon: Pencil },
]

const MOBILE_MODES = MODES.filter((m) => m.id !== 'split')

export default function ModeSwitch({
  mode,
  onChange,
  viewBadge = 0,
  availableModes,
}: {
  mode: Mode
  onChange: (m: Mode) => void
  /** Count of unresolved comments/suggestions — shown on the View toggle to prompt a review. */
  viewBadge?: number
  /** Restrict which modes are shown. Omit to show all. */
  availableModes?: Mode[]
}) {
  const isMobile = useIsMobile()
  // Split is not available on mobile — map it to edit so the active state stays consistent.
  const effectiveMode = isMobile && mode === 'split' ? 'edit' : mode

  const desktopModes = availableModes ? MODES.filter((m) => availableModes.includes(m.id)) : MODES
  const mobileModes = availableModes
    ? MOBILE_MODES.filter((m) => availableModes.includes(m.id))
    : MOBILE_MODES

  // Mobile: compact icon-only trigger + floating dropdown so no layout shift on open.
  if (isMobile) {
    // A switch with a single option is redundant (read-only users) — render nothing.
    if (mobileModes.length <= 1) return null
    const current = mobileModes.find((m) => m.id === effectiveMode) ?? mobileModes[mobileModes.length - 1]
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`View mode: ${current.label}`}
            className={cn(
              'relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted',
              'focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
            )}
          >
            <current.Icon className="size-3.75" aria-hidden />
            {viewBadge > 0 && effectiveMode !== 'view' && (
              <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary ring-2 ring-background" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-28">
          {mobileModes.map(({ id, label, Icon }) => (
            <DropdownMenuItem
              key={id}
              onSelect={() => onChange(id)}
              className={cn('gap-2', effectiveMode === id && 'bg-accent font-medium')}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Desktop: inline tab-style switch.
  if (desktopModes.length <= 1) return null
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5"
    >
      {desktopModes.map(({ id, label, Icon }) => {
        const active = effectiveMode === id
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.82rem] font-medium transition-colors',
              'focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange(id)}
          >
            <Icon className="size-3.75" aria-hidden />
            <span className="max-sm:sr-only">{label}</span>
            {id === 'view' && viewBadge > 0 && (
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.6rem] font-bold leading-none',
                  active ? 'bg-primary/20 text-link' : 'bg-primary text-primary-foreground',
                )}
              >
                {viewBadge > 99 ? '99+' : viewBadge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
