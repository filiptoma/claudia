import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Accent = 'primary' | 'indigo' | 'muted'

const CHIP: Record<Accent, string> = {
  primary: 'bg-primary/12 text-foreground ring-1 ring-primary/20',
  indigo: 'bg-accent2/12 text-accent2 ring-1 ring-accent2/20',
  muted: 'bg-muted text-muted-foreground ring-1 ring-border',
}

/**
 * The centered "nothing here yet" state shared by the dashboard, project, folder, workspace and
 * quick-notes pages. When a page is empty this is the *only* place create actions appear — the
 * header's New control is hidden — so the screen offers one clear call to action instead of several.
 */
export default function EmptyState({
  icon,
  title,
  hint,
  actions,
  accent = 'primary',
  className,
}: {
  icon: ReactNode
  title: string
  hint?: string
  actions?: ReactNode
  accent?: Accent
  className?: string
}) {
  return (
    <div className={cn('mx-auto mt-[10vh] flex max-w-md flex-col items-center text-center', className)}>
      <span className={cn('mb-5 flex size-16 items-center justify-center rounded-2xl [&_svg]:size-8', CHIP[accent])}>
        {icon}
      </span>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {hint && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{hint}</p>}
      {actions && <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">{actions}</div>}
    </div>
  )
}
