import { Eye, Columns2, Pencil } from 'lucide-react'

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
    <div className="mode-switch" role="tablist" aria-label="View mode">
      {MODES.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={mode === id}
          className={mode === id ? 'active' : ''}
          onClick={() => onChange(id)}
        >
          <Icon size={15} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
