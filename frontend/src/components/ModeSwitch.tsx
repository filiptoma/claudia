import { Eye, Columns2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Mode = 'view' | 'split' | 'edit'

const MODES: { id: Mode; label: string; Icon: typeof Eye }[] = [
  { id: 'view', label: 'View', Icon: Eye },
  { id: 'split', label: 'Split', Icon: Columns2 },
  { id: 'edit', label: 'Edit', Icon: Pencil },
]

export default function ModeSwitch({
  mode,
  onChange,
}: {
  mode: Mode
  onChange: (m: Mode) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5"
    >
      {MODES.map(({ id, label, Icon }) => {
        const active = mode === id
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
          </button>
        )
      })}
    </div>
  )
}
