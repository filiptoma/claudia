import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

export default function ViewAllCard({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-4 text-sm font-medium text-muted-foreground transition-colors hover:border-accent2/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      {label}
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
