import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-sm shadow-sm [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted/40 text-foreground [&>svg]:text-muted-foreground',
        // A proper amber "heads up / beta" callout — deliberately NOT the gold brand primary, and softer
        // than the destructive red. The icon pops, the body inherits a toned-down amber, and a faint ring
        // lifts it off the surface. Both themes are tuned for contrast.
        warning:
          'border-amber-400/50 bg-amber-50 text-amber-950 ring-1 ring-amber-500/10 [&>svg]:text-amber-500 [&_[data-slot=alert-description]]:text-amber-900/80 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-50 dark:ring-amber-300/10 dark:[&>svg]:text-amber-400 dark:[&_[data-slot=alert-description]]:text-amber-100/75',
        destructive:
          'border-destructive/30 bg-destructive/10 text-destructive [&>svg]:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div role="alert" data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="alert-title" className={cn('font-medium leading-snug', className)} {...props} />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-sm leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { Alert, AlertTitle, AlertDescription, alertVariants }
