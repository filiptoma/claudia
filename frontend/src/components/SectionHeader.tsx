import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

export default function SectionHeader({
  icon,
  title,
  to,
  actionLabel,
}: {
  icon?: ReactNode
  title: string
  to: string
  actionLabel: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        {title}
      </h2>
      <Link
        to={to}
        className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent2 hover:underline"
      >
        {actionLabel} <ArrowRight className="size-3" />
      </Link>
    </div>
  )
}
