import type * as React from 'react'

import { cn } from '@/lib/utils'

// Styled, "dumb" table primitives so the same striped/bordered look can be reused app-wide without
// tanstack. They just render children — full borders + zebra striping + filled header, matching the
// `.md table` aesthetic in index.css.

export function PlainTable({ className, children, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card overflow-hidden">
      <table className={cn('w-full text-sm border-collapse', className)} {...props}>
        {children}
      </table>
    </div>
  )
}

export function PlainTableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={className} {...props} />
}

export function PlainTableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={className} {...props} />
}

export function PlainTableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-border last:border-0 even:bg-muted/30 hover:bg-muted/40',
        className,
      )}
      {...props}
    />
  )
}

export function PlainTableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'bg-muted text-xs font-semibold tracking-wide text-muted-foreground uppercase px-3 h-10 text-left',
        className,
      )}
      {...props}
    />
  )
}

export function PlainTableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />
}
