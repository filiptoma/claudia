// ─────────────────────────────────────────────────────────────────────────────
// THE LaTeX ENGINE ADAPTER — the ONE place allowed to touch `texlyre-busytex`.
//
// Portability rule (§3.14 of the plan, and the [[astronote-licensing-latex-engine]] memory): the rest
// of the app (vfs.ts, errors.ts, useLatexCompile, every component) depends ONLY on the app-owned
// interface exported here — `compileLatex(files, mainPath) => { pdf, log, errors }` — and NEVER on the
// engine's own types (BusyTexRunner / CompileOptions / FileInput …). Keep it that way: if AstroNote
// ever swaps the AGPL fork for upstream MIT `busytex` (or any other WASM TeX), only THIS file changes.
//
// The engine runs entirely in the browser in a Web Worker; nothing here runs on a server. The heavy
// WASM + TeX Live data assets (~hundreds of MB) are NOT bundled — they are served as static files at
// `BUSYTEX_BASE_PATH` and lazy-fetched by the worker on first compile. See ./README.md for how those
// assets are hosted (local dev: `public/assets/busytex/` via Vite; production: an R2-backed
// same-origin route, because individual TeX Live `.data` files exceed Cloudflare Pages' 25 MiB limit).
// ─────────────────────────────────────────────────────────────────────────────

import { parseLog, type ParsedError } from './errors'

export type { ParsedError } from './errors'

/** A single virtual-filesystem entry handed to the compiler. App-owned (deliberately mirrors, but is
 *  not, the engine's FileInput) so the engine type never crosses this module boundary. `path` is
 *  memfs-relative (e.g. `main.tex`, `chapters/ch1.tex`, `refs.bib`); binary assets use Uint8Array. */
export interface LatexFile {
  path: string
  content: string | Uint8Array
}

/** The adapter's stable result shape — everything the UI needs, nothing engine-specific. */
export interface CompileOutput {
  /** Compiled PDF bytes, or null when the run produced no PDF (hard error). */
  pdf: Uint8Array | null
  /** The full raw TeX log (always shown verbatim in the LogPanel). */
  log: string
  /** Structured diagnostics parsed from `log` for click-to-line navigation. */
  errors: ParsedError[]
  /** Whether the engine reported a clean run (exit code 0) AND produced a PDF. */
  success: boolean
  /** Wall-clock duration of the compile in ms (for the status chip / dev harness). */
  durationMs: number
}

export interface CompileLatexOptions {
  /**
   * Fast single-pass build for the live/typing loop: forces bibtex + rerun OFF, so the engine runs ONE
   * xelatex pass + dvipdfmx instead of the latex→bibtex→latex×N pipeline. Much faster (no persisted
   * .aux between compiles means a full build re-resolves refs from scratch every time), at the cost of
   * cross-references / citations showing as `??` until a full build. Default false (full, correct build).
   */
  draft?: boolean
  /** Run bibtex8 + an extra pass for citations. Default: auto (only when the source has \cite/\bibliography). */
  bibtex?: boolean
  /** Run makeindex (for `\printindex`). Default false. */
  makeindex?: boolean
  /** Re-run latex until references stabilise. Default true (ignored when draft). */
  rerun?: boolean
  /** Engine log verbosity forwarded to the worker. Default 'silent' (we parse `log` ourselves). */
  verbose?: 'silent' | 'info' | 'debug'
  /** Override the on-demand TeX Live endpoint for this compile (else the env/default value). */
  remoteEndpoint?: string
}

// A document needs bibtex only if it actually cites/loads a bibliography. Running bibtex8 otherwise is a
// wasted engine invocation (and logs a spurious "couldn't open main.aux"). Covers natbib/biblatex/base.
const CITATION_RE = /\\(?:cite[a-zA-Z]*|nocite|bibliography|addbibresource|printbibliography)\b/
function hasCitations(files: LatexFile[]): boolean {
  return files.some((f) => typeof f.content === 'string' && CITATION_RE.test(f.content))
}

// ── Configuration (env-overridable so production can repoint assets without a code change) ──────────
// Same-origin path the worker + WASM + data packages are served from. MUST stay same-origin in prod
// (classic Workers can't be loaded cross-origin), which is why production fronts the R2 bucket with a
// same-origin route rather than using an R2 custom domain directly. See ./README.md.
const BUSYTEX_BASE_PATH = import.meta.env.VITE_BUSYTEX_BASE_PATH ?? '/assets/busytex'

// On-demand CTAN/TeX Live mirror for packages beyond the preloaded collection. Empty = disabled
// (rely solely on the preloaded data packages below). There is no free public endpoint; point this at
// a self-hosted texlive-ondemand-server when you need packages past `texlive-basic`.
const REMOTE_ENDPOINT = import.meta.env.VITE_TEXLIVE_REMOTE_ENDPOINT ?? ''

// TeX Live data collections PRELOADED (held resident) in the worker at init (each is a `<name>.js`
// loader beside its `<name>.data` payload under BUSYTEX_BASE_PATH). `texlive-basic` (~90 MB) covers
// article/report + the most common packages (amsmath, graphicx, hyperref, geometry, …) and is the hot
// set every compile carries — keep it small. Anything heavier should ride the CATALOG below, not here.
const DATA_COLLECTIONS = (import.meta.env.VITE_BUSYTEX_COLLECTIONS ?? 'texlive-basic.js')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// TeX Live collections AVAILABLE to the on-demand package resolver but NOT preloaded. The pipeline
// reads each loader's `\ProvidesPackage` list and mounts a collection's `.data` ONLY when a document
// actually uses a package from it (and caches it on the reused worker afterwards). So this is the full
// menu — a plain article stays light on `texlive-basic`, while a doc that pulls in `float` (recommended)
// or `titlesec`/`placeins` (extra) loads just those collections on first use. Without this, packages
// beyond `texlive-basic` fail with "File `xyz.sty' not found". Trim it to cap peak worker memory.
const CATALOG_COLLECTIONS = (
  import.meta.env.VITE_BUSYTEX_CATALOG ?? 'texlive-basic.js,texlive-recommended.js,texlive-extra.js'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Combined engine build (busytex.wasm) — supports the xetex driver and is guaranteed present in the
// asset bundle. Switch to 'xetex' to shrink the per-user WASM download once that split build is
// verified against the deployed assets.
const ENGINE_MODE = 'combined' as const
// XeLaTeX driver: correct for Unicode/Czech + OpenType fonts (fithesis's recommended engine), with
// bibtex8 (NOT biber — biber can't run in WASM) and dvipdfmx.
const DRIVER = 'xetex_bibtex8_dvipdfmx' as const

// The engine's BusyTexRunner instance type, referenced only INSIDE this module (does not leak past it).
type EngineRunner = InstanceType<typeof import('texlyre-busytex').BusyTexRunner>

// One worker, reused across compiles (init is expensive: it fetches+instantiates the WASM and the
// preloaded data packages). Cached as a promise so concurrent first-callers share a single init.
let runnerPromise: Promise<EngineRunner> | null = null

async function getRunner(): Promise<EngineRunner> {
  if (!runnerPromise) {
    runnerPromise = (async () => {
      const { BusyTexRunner } = await import('texlyre-busytex')
      const runner = new BusyTexRunner({
        busytexBasePath: BUSYTEX_BASE_PATH,
        engineMode: ENGINE_MODE,
        preloadDataPackages: DATA_COLLECTIONS.map((c) => `${BUSYTEX_BASE_PATH}/${c}`),
        // The on-demand menu: collections the resolver may mount when a doc needs a package they provide.
        catalogDataPackages: CATALOG_COLLECTIONS.map((c) => `${BUSYTEX_BASE_PATH}/${c}`),
        verbose: false,
      })
      try {
        await runner.initialize(true) // true → run in a Web Worker (non-blocking)
      } catch (err) {
        runnerPromise = null // let the next call retry a failed init (e.g. transient asset fetch)
        throw err
      }
      return runner
    })()
  }
  return runnerPromise
}

// The engine worker is single and reassigns its onmessage per compile, so overlapping compiles would
// clobber each other. Serialise all compiles through this chain — the adapter stays safe even if a
// caller forgets to guard (useLatexCompile also guards, belt-and-braces).
let queue: Promise<unknown> = Promise.resolve()

/**
 * Compile a LaTeX project to PDF, entirely in the browser. Pass every project file (the main .tex,
 * \input-ed chapters, .bib files, binary assets, any bundled class/style files) and the memfs path of
 * the compile root. Always resolves to a CompileOutput — engine/asset/load failures are surfaced in
 * `log`/`errors` with `pdf: null` rather than thrown, so the UI always has something to show.
 */
export async function compileLatex(
  files: LatexFile[],
  mainPath: string,
  opts: CompileLatexOptions = {},
): Promise<CompileOutput> {
  const run = queue.then(() => compileOnce(files, mainPath, opts))
  // Keep the chain alive regardless of this compile's outcome.
  queue = run.catch(() => undefined)
  return run
}

async function compileOnce(
  files: LatexFile[],
  mainPath: string,
  opts: CompileLatexOptions,
): Promise<CompileOutput> {
  const started = Date.now()
  const fail = (log: string): CompileOutput => ({
    pdf: null,
    log,
    errors: parseLog(log).length ? parseLog(log) : [{ file: '', line: null, message: log.split('\n')[0] || 'Compile failed', severity: 'error' }],
    success: false,
    durationMs: Date.now() - started,
  })

  if (!files.some((f) => f.path === mainPath)) {
    return fail(`Compile root "${mainPath}" is not among the ${files.length} project file(s).`)
  }

  let runner: EngineRunner
  try {
    runner = await getRunner()
  } catch (err) {
    return fail(`Failed to load the LaTeX engine assets from ${BUSYTEX_BASE_PATH}. ${errMsg(err)}`)
  }

  // Draft → one fast pass (no bibtex, no rerun). Full → bibtex only if the source cites anything, and
  // rerun until refs settle. This is the single biggest compile-time lever for the typing loop.
  const draft = opts.draft ?? false
  const bibtex = draft ? false : (opts.bibtex ?? hasCitations(files))
  const rerun = draft ? false : (opts.rerun ?? true)

  try {
    // runner.compile takes the FULL file list + the main path (it writes them all to memfs and
    // compiles mainPath); no input/additionalFiles split needed. Args are positional in the engine API.
    const result = await runner.compile(
      files, // engine FileInput[] is structurally { path, content } — LatexFile matches by shape
      mainPath,
      bibtex,
      opts.makeindex ?? false,
      rerun,
      opts.verbose ?? 'silent',
      DRIVER,
      null, // dataPackagesJs: on-demand catalog packages — none beyond the preloaded collection
      (opts.remoteEndpoint ?? REMOTE_ENDPOINT) || undefined,
    )
    const log = result.log ?? ''
    return {
      pdf: result.pdf ?? null,
      log,
      errors: parseLog(log),
      success: !!result.success && !!result.pdf,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    return fail(`LaTeX compile failed: ${errMsg(err)}`)
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Tear down the cached worker (e.g. to recover from a wedged engine, or on a hosting/base-path
 *  change). The next compileLatex() lazily re-inits. */
export async function disposeLatexEngine(): Promise<void> {
  if (!runnerPromise) return
  const p = runnerPromise
  runnerPromise = null
  try {
    const runner = await p
    runner.terminate()
  } catch {
    // init never finished — nothing to terminate.
  }
}
