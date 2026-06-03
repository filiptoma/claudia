import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-6 animate-spin text-muted-foreground', className)} aria-hidden />
}

/** Centered spinner that fills its (flex/height-constrained) parent. */
export function CenteredSpinner({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex h-full min-h-40 w-full flex-1 flex-col items-center justify-center gap-3', className)}>
      <Spinner className="size-7" />
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  )
}

/** Whole-viewport spinner used while auth/session is still initializing. */
export function FullPageSpinner() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <Spinner className="size-9" />
    </div>
  )
}
