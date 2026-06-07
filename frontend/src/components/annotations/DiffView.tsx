import { cn } from '@/lib/utils'
import { diffRows } from '../../lib/diff'
import type { DiffSegment } from '../../lib/diff'

function CharSeg({ seg }: { seg: DiffSegment }) {
  return (
    <span
      className={cn(
        seg.op === 'delete' && 'rounded-[2px] bg-destructive/40',
        seg.op === 'insert' && 'rounded-[2px] bg-emerald-500/40',
      )}
    >
      {seg.text}
    </span>
  )
}

// Renders a diff between `original` and `suggested` markdown strings, red (deleted) / green (inserted).
// Paired delete+insert lines collapse into one "change" row whose inline character diff is interleaved
// (deletions and insertions in place, like git) — equal context shown once, unstyled.
export default function DiffView({ original, suggested }: { original: string; suggested: string }) {
  const rows = diffRows(original || '', suggested || '')
  return (
    <div className="overflow-hidden rounded-md border border-border text-[0.78rem]">
      {rows.map((row, i) => {
        if (row.type === 'change') {
          return (
            <div key={i} className="flex min-w-0 px-2 py-0.5 font-mono leading-relaxed">
              <span className="mr-2 shrink-0 select-none font-bold text-muted-foreground/50">~</span>
              <span className="min-w-0 whitespace-pre-wrap wrap-break-word">
                {(row.segments ?? []).map((seg, j) => <CharSeg key={j} seg={seg} />)}
              </span>
            </div>
          )
        }
        return (
          <div
            key={i}
            className={cn(
              'flex min-w-0 px-2 py-0.5 font-mono leading-relaxed',
              row.type === 'delete' && 'bg-destructive/10',
              row.type === 'insert' && 'bg-emerald-500/10',
            )}
          >
            <span
              className={cn(
                'mr-2 shrink-0 select-none font-bold',
                row.type === 'delete' && 'text-destructive',
                row.type === 'insert' && 'text-emerald-600 dark:text-emerald-400',
                row.type === 'context' && 'text-muted-foreground/50',
              )}
            >
              {row.type === 'delete' ? '−' : row.type === 'insert' ? '+' : ' '}
            </span>
            <span className="min-w-0 whitespace-pre-wrap wrap-break-word">{row.text || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}
