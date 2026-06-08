import { Download, FileText, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import PdfPreview from './PdfPreview'
import LogPanel from './LogPanel'
import type { UseLatexCompile } from '../../hooks/useLatexCompile'
import { useLatexErrorJump } from '../../hooks/useLatexErrorJump'
import type { ParsedError } from '../../lib/latex/compiler'
import type { Project } from '../../lib/types'

// The compiled-PDF preview, in two flavours that share one body (the PDF area + LogPanel):
//
//  • LatexPreviewPane (named) — the SPLIT editor's right pane. The editor owns the compile state (its
//    toolbar drives Compile / auto-compile / Download), so this is pure presentation: it just renders
//    whatever compile state it's handed.
//  • LatexPreview (default) — VIEW mode (read-only, full width). It OWNS its own compile state, compiles
//    the project's main doc on mount, and gets its own minimal header (Compile/Refresh + Download) so a
//    "Can view" member can see and download the PDF without an editor.

/** Shared inner body: the PDF area (with compile/empty placeholders) above the collapsible log. */
function PreviewBody({
  compile,
  onJump,
}: {
  compile: UseLatexCompile
  onJump?: (e: ParsedError) => void
}) {
  const { status, pdf, log, errors, durationMs } = compile
  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="relative min-h-0 flex-1">
        {pdf ? (
          <PdfPreview bytes={pdf} />
        ) : (
          <PreviewPlaceholder compiling={status === 'compiling'} failed={status === 'error'} />
        )}
        {/* A subtle "recompiling" veil over a stale PDF so the user knows a fresh build is underway. */}
        {pdf && status === 'compiling' && (
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            <Loader2 className="size-3.5 animate-spin" /> Compiling…
          </div>
        )}
      </div>
      <LogPanel status={status} log={log} errors={errors} durationMs={durationMs} onJump={onJump} />
    </div>
  )
}

function PreviewPlaceholder({ compiling, failed }: { compiling: boolean; failed: boolean }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
      {compiling ? (
        <>
          <Loader2 className="size-7 animate-spin opacity-70" />
          <p className="text-sm">Compiling the PDF…</p>
        </>
      ) : failed ? (
        <>
          <FileText className="size-7 opacity-60" />
          <p className="text-sm">Compile failed — see the log below.</p>
        </>
      ) : (
        <>
          <FileText className="size-7 opacity-60" />
          <p className="text-sm">Compile to see the PDF.</p>
        </>
      )}
    </div>
  )
}

/** Split-mode right pane — presentation only; the editor owns and passes `compile`. */
export function LatexPreviewPane({
  compile,
  onJump,
  className,
}: {
  compile: UseLatexCompile
  onJump?: (e: ParsedError) => void
  className?: string
}) {
  return (
    <div className={cn('h-full min-h-0', className)}>
      <PreviewBody compile={compile} onJump={onJump} />
    </div>
  )
}

/** View mode — read-only, full width. The compile state is owned by LatexDocumentBody and passed in, so
 *  switching to/from split reuses the PDF instead of recompiling (§5). */
export default function LatexPreview({
  project,
  canEdit,
  compile,
}: {
  project: Project
  /** Editors can click a diagnostic to jump into the source (split mode); viewers can't, so rows are inert. */
  canEdit: boolean
  compile: UseLatexCompile
}) {
  const runCompile = compile.compile
  const jump = useLatexErrorJump(project, { enabled: canEdit })

  const compiling = compile.status === 'compiling'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border bg-card/40 px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" onClick={() => runCompile({ manual: true })} disabled={compiling}>
              {compiling ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {compile.compiledAt ? 'Recompile' : 'Compile'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{'Full build — resolves cross-references, citations & bibliography'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={compile.download}
              disabled={!compile.hasPdf}
            >
              <Download />
              <span className="max-sm:hidden">Download PDF</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download the compiled PDF</TooltipContent>
        </Tooltip>
      </div>
      <PreviewBody compile={compile} onJump={canEdit ? jump : undefined} />
    </div>
  )
}
