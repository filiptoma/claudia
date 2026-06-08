import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface MenuAction {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  separatorBefore?: boolean
}

/**
 * A "⋯" overflow menu. The trigger is fully hidden until the containing `.group` is hovered
 * (and stays visible while the menu is open). `stopPropagation` keeps clicks from also firing
 * the navigation handler on the row/card the menu sits inside.
 */
export default function ActionsMenu({
  actions,
  label = 'Actions',
  alwaysVisible = false,
  triggerClassName,
  align = 'end',
  children,
}: {
  actions: MenuAction[]
  label?: string
  alwaysVisible?: boolean
  triggerClassName?: string
  align?: 'start' | 'center' | 'end'
  /** Extra menu content rendered after the actions (e.g. an Export section). */
  children?: ReactNode
}) {
  if (actions.length === 0 && !children) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'size-7 shrink-0 text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground [&_svg]:size-4',
            alwaysVisible ? 'flex' : 'hidden group-hover:flex data-[state=open]:flex',
            triggerClassName,
          )}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} onClick={(e) => e.stopPropagation()}>
        {actions.flatMap((a) => [
          a.separatorBefore ? <DropdownMenuSeparator key={`${a.label}:sep`} /> : null,
          <DropdownMenuItem
            key={a.label}
            variant={a.danger ? 'destructive' : 'default'}
            onSelect={() => a.onSelect()}
          >
            {a.icon}
            {a.label}
          </DropdownMenuItem>,
        ])}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
