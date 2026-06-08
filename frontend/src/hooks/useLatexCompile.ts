import { useCallback, useEffect, useRef, useState } from 'react'
import { compileLatex, type ParsedError } from '../lib/latex/compiler'
import { buildProjectVirtualFiles } from '../lib/latex/vfs'
import { downloadFile, exportFilename } from '../lib/typst/export'
import type { CompileStatus } from '../components/latex/LatexToolbar'
import type { Project } from '../lib/types'

// The UI-facing compile state machine for a LaTeX project. It is the single owner of a compile's
// lifecycle and result, shared by the editor's toolbar (Compile / status chip / Download) and the
// preview pane (PDF + log) so the two can never drift. It talks ONLY to the app-owned adapter
// (`compileLatex`) and the VFS builder — never to the engine directly (§3.14 boundary).
//
// `compile()` gathers the project's files fresh on each run (so other docs' saved edits are picked up),
// optionally overlays the open editor's unsaved buffer via `getOverride`, and serialises overlapping
// requests (one in flight, at most one queued) on top of the adapter's own queue — belt-and-braces.

export interface LatexCompileState {
  status: CompileStatus
  /** Bytes of the most recent successful PDF (kept across a later failed compile, Overleaf-style). */
  pdf: Uint8Array | null
  /** Full raw TeX log from the last run (shown verbatim in the LogPanel). */
  log: string
  /** Parsed diagnostics from the last run, for click-to-line navigation. */
  errors: ParsedError[]
  /** Wall-clock duration of the last run, ms (null before the first compile). */
  durationMs: number | null
  /** When the last run finished (null before the first compile). */
  compiledAt: Date | null
  /** Whether the last run was a fast single-pass draft (refs/citations may be unresolved). */
  draft: boolean
}

export interface UseLatexCompile extends LatexCompileState {
  /** Whether a downloadable PDF currently exists. */
  hasPdf: boolean
  /** Run a compile (no-op-coalesced while one is already running). `draft` → fast single pass. */
  compile: (opts?: { draft?: boolean }) => void
  /** Download the last successful PDF as `<project name>.pdf`. */
  download: () => void
}

const IDLE: LatexCompileState = {
  status: 'idle',
  pdf: null,
  log: '',
  errors: [],
  durationMs: null,
  compiledAt: null,
  draft: false,
}

export function useLatexCompile(
  project: Pick<Project, 'id' | 'name' | 'main_document_id'>,
  /** Returns the open editor's unsaved buffer for the doc being edited, or null (e.g. view mode). */
  getOverride?: () => { id: string; content: string } | null,
): UseLatexCompile {
  const [state, setState] = useState<LatexCompileState>(IDLE)

  // Refs keep `compile`/`download` stable across renders despite changing inputs. They're synced in an
  // effect (never in render — refs must not be touched during render) and read only at call time.
  const overrideRef = useRef(getOverride)
  const pdfRef = useRef<Uint8Array | null>(null)
  const projectRef = useRef(project)
  useEffect(() => {
    overrideRef.current = getOverride
    projectRef.current = project
  })

  const running = useRef(false)
  const queued = useRef(false)
  // Draft flag for the next (queued) run. A full request (draft=false) must win over a later draft, so
  // the coalesced re-run isn't silently downgraded to a draft while one is in flight.
  const nextDraft = useRef(false)

  // One in-flight compile at a time; a request made while one is running coalesces into a single re-run
  // (the do/while), so rapid auto-compiles never stack. The loop avoids a self-referencing callback,
  // which the React Compiler can't memoize.
  const compile = useCallback((compileOpts?: { draft?: boolean }) => {
    const draft = compileOpts?.draft ?? false
    if (running.current) {
      queued.current = true
      nextDraft.current = nextDraft.current && draft // a full request overrides a queued draft
      return
    }
    nextDraft.current = draft
    void (async () => {
      running.current = true
      try {
        do {
          const useDraft = nextDraft.current
          queued.current = false
          setState((s) => ({ ...s, status: 'compiling' }))
          const { id, main_document_id } = projectRef.current
          try {
            const { files, mainPath } = await buildProjectVirtualFiles({
              projectId: id,
              mainDocId: main_document_id,
              override: overrideRef.current?.() ?? null,
            })
            const result = await compileLatex(files, mainPath, { draft: useDraft })
            if (result.pdf) pdfRef.current = result.pdf // retain the last good PDF for download + preview
            setState((prev) => ({
              status: result.success ? 'success' : 'error',
              pdf: result.pdf ?? prev.pdf, // keep the last good PDF visible when a run produces none
              log: result.log,
              errors: result.errors,
              durationMs: result.durationMs,
              compiledAt: new Date(),
              draft: useDraft,
            }))
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            setState((prev) => ({
              ...prev,
              status: 'error',
              log: message,
              errors: [{ file: '', line: null, message, severity: 'error' }],
              compiledAt: new Date(),
              draft: useDraft,
            }))
          }
        } while (queued.current) // an edit arrived mid-compile → run exactly once more with it
      } finally {
        running.current = false
      }
    })()
  }, [])

  const download = useCallback(() => {
    const pdf = pdfRef.current
    if (pdf) downloadFile(exportFilename(projectRef.current.name, 'pdf'), pdf, 'application/pdf')
  }, [])

  // Drop the retained PDF when this hook tears down (or the project changes), so a stale PDF can never
  // be downloaded after navigating away. State resets on its own because each project remounts the host.
  useEffect(() => {
    return () => {
      pdfRef.current = null
    }
  }, [project.id])

  return {
    ...state,
    hasPdf: !!state.pdf,
    compile,
    download,
  }
}
