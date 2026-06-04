import { ChevronDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { MenuAction } from './ActionsMenu'

type ButtonVariant = 'default' | 'accent' | 'soft' | 'outline' | 'secondary' | 'ghost'
type ButtonSize = 'sm' | 'default' | 'lg'

/**
 * The single canonical "create" control used on the listing pages (header when populated, empty
 * state when not). One create option renders as a plain button; several collapse into a single
 * "New ▾" dropdown — so a page never shows a row of competing New-X buttons.
 */
export default function CreateMenu({
  actions,
  label = 'New',
  variant = 'default',
  size = 'sm',
  className,
  align = 'end',
}: {
  actions: MenuAction[]
  label?: string
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  align?: 'start' | 'center' | 'end'
}) {
  if (actions.length === 0) return null

  // A single option needs no menu — show it directly (keeping its own icon and label).
  if (actions.length === 1) {
    const a = actions[0]
    return (
      <Button variant={variant} size={size} className={className} onClick={() => a.onSelect()}>
        {a.icon ?? <Plus />}
        {a.label}
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <Plus />
          {label}
          <ChevronDown className="-mr-1 size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-44">
        {actions.map((a) => (
          <DropdownMenuItem key={a.label} onSelect={() => a.onSelect()} className={cn(a.danger && 'text-destructive')}>
            {a.icon}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
