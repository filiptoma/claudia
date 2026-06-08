// TeX compile-log parsing — turns a raw engine log into structured diagnostics the UI can render as
// clickable "jump to file:line" rows (see the LogPanel in M5). This file is PURE (no engine, no DOM,
// no Supabase): given a log string it returns ParsedError[]. The engine adapter (compiler.ts) calls
// parseLog on the log it gets back; nothing here imports texlyre-busytex, so the engine boundary
// (§3.14) stays intact.
//
// We match the two diagnostic shapes a TeX run emits:
//   1. file-line-error form (the primary one):   ./main.tex:42: Undefined control sequence.
//   2. the classic two-line form:                ! Undefined control sequence.
//                                                l.42 \badcommand
//      — here the line comes from the `l.NN` follow-up and the file from paren-nesting `(./file …)`.
// Plus LaTeX/package warnings carrying "… on input line NN.".

/** One parsed diagnostic. `file` is a memfs-relative path (leading `./` stripped); '' when unknown.
 *  The UI maps `file` back to a document via its `<folder.name>/<title>` memfs path (§3.10). */
export interface ParsedError {
  file: string
  line: number | null
  message: string
  severity: 'error' | 'warning'
}

// Extensions that mark a parenthesised token in the log as a real file being opened (for paren-based
// current-file tracking) and that make a `file:line:` prefix trustworthy.
const TEX_FILE_EXT = /\.(?:tex|ltx|sty|cls|def|cfg|clo|fd|bib|aux|toc|lof|lot|out|bbl|nav|snm)$/i

// `<file>:<line>: <message>` — the file-line-error form. The file guard (extension OR a path-looking
// prefix) keeps us from misreading unrelated colon-number-colon text in package chatter.
const FILE_LINE_RE = /^(\/?[^\s:][^:]*):(\d+):\s?(.*)$/
// `! <message>` — start of a classic error block.
const BANG_RE = /^!\s+(.*?)\s*$/
// `l.<line> <source excerpt>` — the line locator that follows a `!` block.
const L_DOT_RE = /^l\.(\d+)\b/
// A LaTeX / package / class Warning or Error line (the `LaTeX Error:` variant also appears with
// file-line-error off). We only keep Warnings here; bare errors arrive via FILE_LINE_RE / BANG_RE.
const NAMED_RE = /^(?:LaTeX|Package\s+\S+|Class\s+\S+|pdfTeX|LuaTeX|Module\s+\S+)\s+(Warning|Error|Info):\s*(.*)$/
const INPUT_LINE_RE = /on input line (\d+)/

const stripDotSlash = (f: string): string => f.replace(/^\.\//, '')
const looksLikePath = (f: string): boolean => TEX_FILE_EXT.test(f) || f.includes('/') || f.startsWith('.')

/**
 * Parse a raw TeX log into a de-duplicated list of diagnostics, ordered as they appear in the log.
 * Resilient by design: anything it doesn't recognise is ignored rather than throwing, so a noisy or
 * truncated log never breaks the compile UI — the raw log is always shown in full alongside this.
 */
export function parseLog(log: string): ParsedError[] {
  const out: ParsedError[] = []
  const seen = new Set<string>()
  const push = (e: ParsedError) => {
    const key = `${e.severity}|${e.file}|${e.line}|${e.message}`
    if (e.message && !seen.has(key)) {
      seen.add(key)
      out.push(e)
    }
  }

  const lines = log.split(/\r?\n/)
  // Best-effort "current file" via paren nesting: TeX prints `(<path>` when it opens a file and a
  // matching `)` when it closes it. We only track tokens that look like real files (known extension),
  // ignoring grouping parens, so the stack stays meaningful enough to attribute `! … l.NN` errors.
  const fileStack: string[] = []
  const currentFile = () => (fileStack.length ? stripDotSlash(fileStack[fileStack.length - 1]) : '')

  // A `!` error whose `l.NN` line we haven't seen yet.
  let pendingBang: { message: string; file: string } | null = null

  const trackParens = (line: string) => {
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '(') {
        // Read the token immediately after '(' up to whitespace or a paren.
        let j = i + 1
        while (j < line.length && !/[\s()]/.test(line[j])) j++
        const token = line.slice(i + 1, j)
        if (token && TEX_FILE_EXT.test(token)) fileStack.push(token)
        i = j - 1
      } else if (c === ')') {
        if (fileStack.length) fileStack.pop()
      }
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    // 1) file-line-error form — the most reliable; gives file + line + message directly.
    const fl = FILE_LINE_RE.exec(line)
    if (fl && looksLikePath(fl[1])) {
      // The error text often continues on the next line, but the first line is enough to locate it.
      push({ file: stripDotSlash(fl[1]), line: Number(fl[2]), message: fl[3].trim() || 'Error', severity: 'error' })
      trackParens(line)
      continue
    }

    // 2a) start of a classic `!` error block — remember it until its `l.NN` locator shows up.
    const bang = BANG_RE.exec(line)
    if (bang) {
      // Flush a previous bang that never got an l.NN (line unknown).
      if (pendingBang) push({ file: pendingBang.file, line: null, message: pendingBang.message, severity: 'error' })
      pendingBang = { message: bang[1], file: currentFile() }
      trackParens(line)
      continue
    }

    // 2b) the `l.NN` locator that completes a pending `!` block.
    const ldot = L_DOT_RE.exec(line)
    if (ldot && pendingBang) {
      push({ file: pendingBang.file, line: Number(ldot[1]), message: pendingBang.message, severity: 'error' })
      pendingBang = null
      trackParens(line)
      continue
    }

    // 3) named warnings (LaTeX/package/class), with an optional "on input line NN".
    const named = NAMED_RE.exec(line)
    if (named && named[1] === 'Warning') {
      const m = INPUT_LINE_RE.exec(line)
      push({
        file: currentFile(),
        line: m ? Number(m[1]) : null,
        message: named[2].trim() || 'Warning',
        severity: 'warning',
      })
      trackParens(line)
      continue
    }

    trackParens(line)
  }

  // A trailing `!` with no l.NN (e.g. truncated log) still surfaces as an error.
  if (pendingBang) push({ file: pendingBang.file, line: null, message: pendingBang.message, severity: 'error' })

  return out
}
