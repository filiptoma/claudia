import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// A navigable "icon + title + subtitle + arrow" card with the app's standard hover-lift.
//
// `transform-gpu` promotes the card to its own compositing layer so the whole card — text included —
// translates as one smooth unit on hover. Without it the small transform repaints the text on the main
// thread each frame, so the title/subtitle appear to lag behind the moving card frame.
export default function LinkCard({
  to,
  icon,
  title,
  description,
  className,
}: {
  to: string
  icon: ReactNode
  title: ReactNode
  description: ReactNode
  className?: string
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex transform-gpu items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm',
        'transition-[transform,box-shadow,border-color] duration-150 ease-out',
        'hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        className,
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-foreground [&_svg]:size-5">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  )
}
