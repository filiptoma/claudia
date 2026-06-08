import { useState } from 'react'
import { AlertCircle, AlertTriangle, Check, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CompileStatus } from './LatexToolbar'
import type { ParsedError } from '../../lib/latex/compiler'

// Collapsible compile-output panel that sits below the PDF preview. Its header always shows the compile
// status + error/warning counts (so failures are still obvious at a glance); it stays COLLAPSED by
// default and only opens when the user clicks it — LaTeX warnings are common and noisy, so we don't pop
// it open on every compile. Expanding reveals the parsed diagnostics (each a click-to-line row, §3.10)
// and the full raw TeX log, in a height-capped scroll area. Pure presentation — `onJump` is the only
// behaviour, wired by the parent.
export default function LogPanel({
  status,
  log,
  errors,
  durationMs,
  onJump,
  className,
}: {
  status: CompileStatus
  log: string
  errors: ParsedError[]
  durationMs: number | null
  /** Jump to a diagnostic's file:line. Rows are only clickable when provided and the error has a line. */
  onJump?: (e: ParsedError) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const errorCount = errors.filter((e) => e.severity === 'error').length
  const warnCount = errors.length - errorCount

  // Nothing worth showing before the first compile.
  if (status === 'idle' && !log) return null

  return (
    <div className={cn('shrink-0 border-t border-border bg-card/40 text-sm', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
        aria-expanded={open}
      >
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', open ? '' : '-rotate-90')} />
        <StatusGlyph status={status} />
        <span className="font-medium">{headline(status, errorCount, warnCount)}</span>
        {durationMs != null && status !== 'compiling' && (
          <span className="text-xs text-muted-foreground">· {(durationMs / 1000).toFixed(1)}s</span>
        )}
      </button>

      {open && (
        <div className="max-h-64 overflow-y-auto border-t border-border">
          {errors.length > 0 && (
            <ul className="divide-y divide-border/60">
              {errors.map((e, i) => (
                <ErrorRow key={`${e.file}:${e.line}:${i}`} error={e} onJump={onJump} />
              ))}
            </ul>
          )}
          <details className="px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
              Raw log{log ? ` (${log.length.toLocaleString()} chars)` : ''}
            </summary>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2.5 font-mono text-xs leading-relaxed text-muted-foreground">
              {log || '(empty)'}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}

function ErrorRow({ error, onJump }: { error: ParsedError; onJump?: (e: ParsedError) => void }) {
  const isError = error.severity === 'error'
  const clickable = !!onJump && error.line != null && !!error.file
  const Icon = isError ? AlertCircle : AlertTriangle
  const body = (
    <>
      <Icon className={cn('mt-0.5 size-4 shrink-0', isError ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')} />
      <span className="min-w-0 flex-1">
        {(error.file || error.line != null) && (
          <span className="mr-2 font-mono text-xs text-muted-foreground">
            {error.file || '?'}
            {error.line != null ? `:${error.line}` : ''}
          </span>
        )}
        <span className="wrap-break-word">{error.message}</span>
      </span>
    </>
  )
  return (
    <li>
      {clickable ? (
        <button
          type="button"
          onClick={() => onJump?.(error)}
          className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/50"
          title="Jump to this line"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-2 px-3 py-2">{body}</div>
      )}
    </li>
  )
}

function StatusGlyph({ status }: { status: CompileStatus }) {
  if (status === 'compiling') return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
  if (status === 'success') return <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
  if (status === 'error') return <AlertCircle className="size-4 shrink-0 text-destructive" />
  return <span className="size-4 shrink-0" />
}

function headline(status: CompileStatus, errorCount: number, warnCount: number): string {
  if (status === 'compiling') return 'Compiling…'
  const parts: string[] = []
  if (errorCount) parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`)
  if (warnCount) parts.push(`${warnCount} warning${warnCount === 1 ? '' : 's'}`)
  if (parts.length) return parts.join(', ')
  if (status === 'success') return 'Compiled — no problems'
  if (status === 'error') return 'Compile failed'
  return 'Compile log'
}
