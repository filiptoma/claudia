import { useCallback, useEffect, useRef, useState } from 'react'
import { compileLatex, warmLatexEngine, type ParsedError } from '../lib/latex/compiler'
import { buildProjectVirtualFiles } from '../lib/latex/vfs'
import { loadPdf, savePdf, type CachedPdf } from '../lib/latex/pdfCache'
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
  /** Run a compile (no-op-coalesced while one is already running). `draft` → fast single pass; `manual`
   *  marks the Compile button (a full build that auto-requests can neither downgrade nor promote into). */
  compile: (opts?: { draft?: boolean; manual?: boolean }) => void
  /** On-open policy: reuse the cached PDF when unchanged, otherwise render a fast DRAFT. NEVER a full
   *  build — a full build happens ONLY when the user clicks Compile. So no open or reload ever fulls. */
  compileIfStale: () => void
  /** Download the last successful PDF as `<project name>.pdf`. */
  download: () => void
}

/** The open editor's unsaved buffer for the doc being edited, overlaid on the project files at compile
 *  time so the preview reflects keystrokes pre-autosave. Returns null when there's no live editor. */
export type GetOverride = () => { id: string; content: string } | null

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
  getOverride?: GetOverride,
  /** Returns a signature of the project's content (e.g. doc ids + updated_at). When it still matches the
   *  cached PDF's signature on open, the recompile is skipped — the cached PDF is already current. */
  getSignature?: () => string,
): UseLatexCompile {
  const [state, setState] = useState<LatexCompileState>(IDLE)

  // Refs keep `compile`/`download` stable across renders despite changing inputs. They're synced in an
  // effect (never in render — refs must not be touched during render) and read only at call time.
  const overrideRef = useRef(getOverride)
  const signatureRef = useRef(getSignature)
  const pdfRef = useRef<Uint8Array | null>(null)
  const projectRef = useRef(project)
  // The in-flight cache-load promise, awaited by compileIfStale so its staleness check sees the cache.
  const cacheLoad = useRef<Promise<CachedPdf | null> | null>(null)
  useEffect(() => {
    overrideRef.current = getOverride
    signatureRef.current = getSignature
    projectRef.current = project
  })

  const running = useRef(false)
  const queued = useRef(false)
  // Draft flag for the next (queued) run, and whether that run is a MANUAL full (the Compile button).
  const nextDraft = useRef(false)
  const nextManual = useRef(false)

  // One in-flight compile at a time; a request made while one is running coalesces into a single re-run
  // (the do/while), so rapid auto-compiles never stack. The loop avoids a self-referencing callback,
  // which the React Compiler can't memoize.
  //
  // `manual` marks the Compile button. The coalescing rule enforces the policy "a full build happens ONLY
  // from the button or a cache miss": a manual full always wins and is never downgraded, while an AUTO
  // request (typing / open) can only ever set the draft flag — so typing during a running full (e.g. a
  // cache-miss full on reload) coalesces the re-run down to a DRAFT instead of being promoted to a full.
  const compile = useCallback((compileOpts?: { draft?: boolean; manual?: boolean }) => {
    const draft = compileOpts?.draft ?? false
    const manual = compileOpts?.manual ?? false
    if (running.current) {
      queued.current = true
      if (manual) {
        nextDraft.current = false // the button's full wins outright
        nextManual.current = true
      } else if (!nextManual.current) {
        nextDraft.current = draft // auto request: latest draft flag wins; never promotes to a full
      }
      return
    }
    nextDraft.current = draft
    nextManual.current = manual
    void (async () => {
      running.current = true
      try {
        do {
          const useDraft = nextDraft.current
          queued.current = false
          nextManual.current = false // consumed; a manual request during this run can re-arm it
          if (import.meta.env.DEV) console.debug(`[latex] compiling — ${useDraft ? 'draft' : 'FULL'}`)
          setState((s) => ({ ...s, status: 'compiling' }))
          const { id, main_document_id } = projectRef.current
          try {
            // Boot the engine (idempotent) concurrently with fetching the project files, so these two
            // slow steps overlap instead of running back-to-back.
            warmLatexEngine()
            const { files, mainPath } = await buildProjectVirtualFiles({
              projectId: id,
              mainDocId: main_document_id,
              override: overrideRef.current?.() ?? null,
            })
            const result = await compileLatex(files, mainPath, { draft: useDraft })
            if (result.pdf) {
              pdfRef.current = result.pdf // retain the last good PDF for download + preview
              // Persist it so reopening/reloading shows it instantly (Overleaf-style). Capture the
              // signature NOW that the compile has finished — by this point the ~800 ms autosave that
              // bumped the doc's updated_at has landed, so the cached signature matches the content the
              // PDF was built from. (Capturing at the START raced the autosave, so an edit → wait for
              // the draft → navigate away → return wrongly looked "changed" and recompiled.)
              void savePdf(id, result.pdf, {
                draft: useDraft,
                compiledAt: Date.now(),
                sig: signatureRef.current?.() ?? '',
              })
            }
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

  // On open, restore the last compiled PDF from the cross-session cache so the preview shows instantly
  // instead of a blank wait. The promise is kept so compileIfStale can await it before deciding whether a
  // recompile is even needed. Only seeds when no compile has started — the compile wins once it lands.
  useEffect(() => {
    let active = true
    const p = loadPdf(project.id)
    cacheLoad.current = p
    void p.then((cached) => {
      if (!active || !cached) return
      pdfRef.current ??= cached.pdf
      setState((prev) =>
        prev.pdf || prev.status === 'compiling'
          ? prev
          : {
              ...prev,
              status: 'success',
              pdf: cached.pdf,
              draft: cached.draft,
              compiledAt: new Date(cached.compiledAt),
            },
      )
    })
    return () => {
      active = false
    }
  }, [project.id])

  // Compile only when the cached PDF is missing or its content signature no longer matches the project —
  // so reopening/reloading an UNCHANGED project shows the cached PDF with NO recompile. We await the
  // cache load first so the decision is made against the real cached entry, not a not-yet-loaded one.
  const compileIfStale = useCallback(() => {
    // Start booting the engine on open (even when we skip the compile) so the next edit's draft isn't a
    // cold (~7 s) start right after a reload.
    warmLatexEngine()
    void (async () => {
      // AUTO-COMPILES ARE NEVER A FULL BUILD. A full build (multi-pass, resolves refs/citations) happens
      // ONLY when the user clicks Compile. On open we reuse the cached PDF when nothing changed, otherwise
      // render a fast DRAFT — so neither the first open nor any reload can trigger a full.
      const cached = await (cacheLoad.current ?? Promise.resolve(null))
      const sig = signatureRef.current?.() ?? ''
      if (cached && cached.sig && sig && cached.sig === sig) {
        if (import.meta.env.DEV) console.debug('[latex] cache HIT — skipping recompile')
        return
      }
      if (import.meta.env.DEV) {
        console.debug(`[latex] draft recompile (${cached ? 'content changed' : 'no cached PDF'})`)
      }
      compile({ draft: true })
    })()
  }, [compile])

  return {
    ...state,
    hasPdf: !!state.pdf,
    compile,
    compileIfStale,
    download,
  }
}
