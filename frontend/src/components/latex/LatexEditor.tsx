import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { BasicSetupOptions, ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { StreamLanguage } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { EditorView, scrollPastEnd } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { materialDark, materialLight } from '@uiw/codemirror-theme-material'
import { useTheme } from '../../context/ThemeContext'
import { cmChrome, cmLightContrast } from '../../lib/cmTheme'
import { useDocumentAutosave } from '../../hooks/useDocumentAutosave'
import { useSplitScrollSync } from '../../hooks/useSplitScrollSync'
import type { GetOverride, UseLatexCompile } from '../../hooks/useLatexCompile'
import { useLatexErrorJump, takePendingJump } from '../../hooks/useLatexErrorJump'
import { cn } from '@/lib/utils'
import LatexToolbar from './LatexToolbar'
import { LatexPreviewPane } from './LatexPreview'
import type { DocumentRec, Project } from '../../lib/types'

// Line numbers help here (it's source code, and clickable errors jump by line); everything else
// matches the markdown editor's lean setup — our own menus, no CodeMirror autocomplete.
const BASIC_SETUP: BasicSetupOptions = {
  lineNumbers: true,
  foldGutter: false,
  highlightActiveLine: false,
  autocompletion: false,
}

// Debounce after the last keystroke before an auto-compile fires. Kept short for a snappy preview; the
// open doc's buffer is overlaid live on every compile (§3.6), so we don't need to wait for the 800 ms
// autosave to land first.
const AUTO_COMPILE_MS = 1000

// Move the editor's selection to a 1-based line and scroll it into view. Used for both same-doc clicks
// (via the live view) and a cross-doc jump handed off through takePendingJump on a fresh editor.
function scrollViewToLine(view: EditorView, line: number) {
  const n = Math.min(Math.max(1, line), view.state.doc.lines)
  const target = view.state.doc.line(n)
  view.dispatch({
    selection: { anchor: target.from, head: target.to },
    effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
  })
  view.focus()
}

// The LaTeX source editor: the same two-pane shell as the markdown Editor but stripped to source +
// toolbar (no annotations / slash menu / image-resize / table logic). In split mode the right pane hosts
// the live compiled-PDF preview, and the toolbar drives the compile state (Compile / auto-compile /
// Download). The compile state is OWNED by LatexDocumentBody and passed in, so it survives mode switches
// (§5); this editor just registers its unsaved buffer (`overrideRef`) and triggers auto-compiles on
// typing. Clicking a diagnostic jumps the source to its line.
export default function LatexEditor({
  doc,
  project,
  showPreview,
  compile,
  overrideRef,
}: {
  doc: DocumentRec
  project: Project
  showPreview: boolean
  /** Shared compile state, owned by LatexDocumentBody so it persists across view/split/edit. */
  compile: UseLatexCompile
  /** The slot LatexDocumentBody reads to overlay this editor's unsaved buffer onto a compile. */
  overrideRef: RefObject<GetOverride | null>
}) {
  const { theme } = useTheme()
  const cmRef = useRef<ReactCodeMirrorRef>(null)
  const { latest, onChange, flush } = useDocumentAutosave(doc)

  // Captured once so cache updates (e.g. our own autosave echo writing documents.content back into the
  // query cache) never reset CodeMirror or jump the caret.
  const [initialValue] = useState(doc.content)
  const [autoCompile, setAutoCompile] = useState(true)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [previewEl, setPreviewEl] = useState<HTMLElement | null>(null)
  const compileTimer = useRef<number | undefined>(undefined)

  useSplitScrollSync(showPreview, scroller, previewEl)

  const runCompile = compile.compile

  // Register this editor's unsaved buffer so the shared compile overlays the latest keystrokes
  // pre-autosave (the closure reads latest.current only when invoked). Cleared on unmount so a later
  // view-mode compile (no editor) falls back to saved content.
  useEffect(() => {
    overrideRef.current = () => ({ id: doc.id, content: latest.current })
    return () => {
      overrideRef.current = null
    }
  }, [doc.id, latest, overrideRef])

  // Same-doc clicks jump in place; everything else navigates to the owning doc + hands off the line.
  const jumpInCurrent = useCallback((line: number) => {
    const view = cmRef.current?.view
    if (view) scrollViewToLine(view, line)
  }, [])
  const jump = useLatexErrorJump(project, { currentDocId: doc.id, jumpInCurrent })

  const handleChange = useCallback(
    (val: string) => {
      onChange(val)
      if (autoCompile) {
        window.clearTimeout(compileTimer.current)
        // Auto-compile is the typing loop → fast single-pass draft. The Compile button does a full build.
        compileTimer.current = window.setTimeout(() => runCompile({ draft: true }), AUTO_COMPILE_MS)
      }
    },
    [onChange, runCompile, autoCompile],
  )

  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      setScroller(view.scrollDOM)
      const line = takePendingJump(doc.id) // a cross-doc error click navigated us here
      if (line != null) requestAnimationFrame(() => scrollViewToLine(view, line))
    },
    [doc.id],
  )

  // Drop any pending auto-compile timer on unmount.
  useEffect(() => () => window.clearTimeout(compileTimer.current), [])

  const cmTheme: Extension = theme === 'dark' ? materialDark : [materialLight, cmLightContrast]
  // scrollPastEnd() keeps a full editor-height of empty space below the last line (so any line can be
  // scrolled to the top) — matching the markdown editor and HackMD.
  const extensions = useMemo(
    () => [StreamLanguage.define(stex), EditorView.lineWrapping, scrollPastEnd(), cmChrome],
    [],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex min-h-0 flex-1', showPreview ? 'max-md:flex-col' : '')}>
        <div
          className={cn(
            'flex min-w-0 flex-col',
            showPreview ? 'flex-1 basis-1/2 border-r border-border max-md:border-r-0 max-md:border-b' : 'flex-1',
          )}
          onBlur={flush}
        >
          <div className="shrink-0 border-b border-border bg-card/40">
            <div className="flex min-h-11 items-center gap-2 px-2.5 py-1">
              <LatexToolbar
                status={compile.status}
                draft={compile.draft}
                autoCompile={autoCompile}
                onToggleAutoCompile={setAutoCompile}
                onCompile={() => runCompile({ manual: true })}
                onDownload={compile.download}
                canDownload={compile.hasPdf}
              />
            </div>
          </div>
          <CodeMirror
            ref={cmRef}
            value={initialValue}
            theme={cmTheme}
            extensions={extensions}
            onChange={handleChange}
            onCreateEditor={handleCreateEditor}
            basicSetup={BASIC_SETUP}
            height="100%"
            className="min-h-0 flex-1 overflow-hidden"
          />
        </div>
        {showPreview && (
          <div ref={setPreviewEl} className="min-h-0 min-w-0 flex-1 basis-1/2">
            <LatexPreviewPane compile={compile} onJump={jump} />
          </div>
        )}
      </div>
    </div>
  )
}
