import { AlertCircle, Check, Download, Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

// The compile lifecycle, shared by the toolbar chip and (in M5) useLatexCompile.
export type CompileStatus = 'idle' | 'compiling' | 'success' | 'error'

// Replaces EditorToolbar for LaTeX projects: Compile, an auto-compile toggle, Download PDF, and a
// status chip. `onCompile`/`onDownload` are wired to the real compile pipeline in M5; until then they
// are omitted and the buttons render disabled (the editor itself is fully functional in M4).
export default function LatexToolbar({
  status,
  draft = false,
  autoCompile,
  onToggleAutoCompile,
  onCompile,
  onDownload,
  canDownload,
}: {
  status: CompileStatus
  /** Whether the current PDF came from a fast single-pass draft (refs/citations may be unresolved). */
  draft?: boolean
  autoCompile: boolean
  onToggleAutoCompile: (next: boolean) => void
  /** Run a full compile. Omitted (→ disabled) until the preview pipeline lands in M5. */
  onCompile?: () => void
  /** Download the last compiled PDF. Omitted (→ disabled) until M5. */
  onDownload?: () => void
  canDownload: boolean
}) {
  const compiling = status === 'compiling'
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button
        size="sm"
        onClick={onCompile}
        disabled={!onCompile || compiling}
        title={onCompile ? 'Full compile — resolves cross-references & bibliography' : 'Compiling arrives with the preview pane'}
      >
        {compiling ? <Loader2 className="animate-spin" /> : <Play />}
        Compile
      </Button>

      <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={autoCompile} onCheckedChange={onToggleAutoCompile} />
        <span className="max-sm:hidden">Auto-compile</span>
        <span className="sm:hidden">Auto</span>
      </label>

      <div className="ml-auto flex items-center gap-2">
        <CompileChip status={status} draft={draft} />
        <Button
          variant="outline"
          size="sm"
          onClick={onDownload}
          disabled={!onDownload || !canDownload}
          title={onDownload ? 'Download the compiled PDF' : 'Download arrives with the preview pane'}
        >
          <Download />
          <span className="max-sm:hidden">Download PDF</span>
        </Button>
      </div>
    </div>
  )
}

// Compact status indicator mirroring the compile state machine. After a successful draft it shows
// "Draft" (with a hint that Compile resolves references) rather than "Compiled".
function CompileChip({ status, draft }: { status: CompileStatus; draft: boolean }) {
  if (status === 'idle') return null
  const map = {
    compiling: { icon: <Loader2 className="size-3.5 animate-spin" />, label: 'Compiling…', cls: 'text-muted-foreground', title: undefined as string | undefined },
    success: draft
      ? { icon: <Check className="size-3.5" />, label: 'Draft', cls: 'text-amber-600 dark:text-amber-400', title: 'Quick draft — click Compile to resolve cross-references & bibliography' }
      : { icon: <Check className="size-3.5" />, label: 'Compiled', cls: 'text-emerald-600 dark:text-emerald-400', title: undefined },
    error: { icon: <AlertCircle className="size-3.5" />, label: 'Error', cls: 'text-destructive', title: undefined },
  } as const
  const s = map[status]
  return (
    <span className={cn('flex items-center gap-1 text-xs font-medium', s.cls)} aria-live="polite" title={s.title}>
      {s.icon}
      {s.label}
    </span>
  )
}
