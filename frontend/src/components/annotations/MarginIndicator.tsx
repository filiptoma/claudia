import { MessageSquare, PencilLine } from 'lucide-react'
import { cn } from '@/lib/utils'

interface IndicatorItem {
  key: string
  kind: 'comment' | 'suggestion'
  active: boolean
  resolved?: boolean
}

// A single margin indicator (or stacked group) rendered to the right of the doc column, aligned to an
// annotation's anchor row. A plain ghost icon button — only the icon colour distinguishes comments
// (primary) from suggestions (accent2); the active one gets a subtle tinted background.
export function MarginDot({
  item,
  onClick,
}: {
  item: IndicatorItem
  onClick: () => void
}) {
  const isComment = item.kind === 'comment'
  return (
    <button
      type="button"
      aria-label={isComment ? 'Open comment' : 'Open suggestion'}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent',
        isComment ? 'text-primary' : 'text-accent2',
        item.active && (isComment ? 'bg-primary/15' : 'bg-accent2/15'),
        item.resolved && 'opacity-50',
      )}
    >
      {isComment ? <MessageSquare className="size-4" /> : <PencilLine className="size-4" />}
    </button>
  )
}

// Groups multiple IndicatorItems that share the same y-position (within tolerance) and stacks them as
// a column of icons starting at that row's top coordinate, offset to the right of the doc column.
export default function MarginIndicatorGroup({
  items,
  top,
  onActivate,
}: {
  items: IndicatorItem[]
  top: number
  onActivate: (key: string) => void
}) {
  return (
    <div className="absolute flex flex-col gap-0.5" style={{ top: `${top}px`, right: '-2.25rem' }}>
      {items.map((item) => (
        <MarginDot key={item.key} item={item} onClick={() => onActivate(item.key)} />
      ))}
    </div>
  )
}
