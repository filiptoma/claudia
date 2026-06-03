import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, RefObject } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { BasicSetupOptions, ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView, keymap } from '@codemirror/view'
import { EditorSelection, Prec } from '@codemirror/state'
import type { EditorState, Extension } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { materialDark, materialLight } from '@uiw/codemirror-theme-material'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, getAccessToken, supabase } from '../lib/supabase'
import { uploadImage } from '../lib/storage'
import { isInTable } from '../lib/mdTable'
import { clampImageWidth, findImages, imageMarkdown, parseImageAt, stepWidth } from '../lib/mdImage'
import { treeKeys, useSignedImages } from '../hooks/useTree'
import type { DocMeta } from '../hooks/useTree'
import { useTheme } from '../context/ThemeContext'
import { toast } from '../lib/toast'
import { cn } from '@/lib/utils'
import Markdown from './Markdown'
import EditorToolbar from './EditorToolbar'
import SlashMenu from './SlashMenu'
import type { SlashCommand, SlashState } from './SlashMenu'
import RefPicker from './RefPicker'
import type { RefAnchor } from './RefPicker'
import type { DocumentRec } from '../lib/types'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const BASIC_SETUP: BasicSetupOptions = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  // We build our own slash reference menu; CodeMirror's autocomplete is not used.
  autocompletion: false,
}

// Editor chrome (font, padding, fill height) handled here rather than in CSS. Font size + line height
// are matched to the rendered markdown (.md) so source and preview lines sit at the same y in split.
const cmChrome = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.95rem',
    lineHeight: '1.7',
  },
  '.cm-content': { padding: '1rem 1rem 5rem' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
})

// The slash commands (stage 1). Only "Reference" today, but the menu is built to grow. `keywords`
// widen what the user can type to match (e.g. `/link`, `/doc`, `/head` all surface Reference).
interface CommandDef extends SlashCommand {
  keywords: string
}
const COMMANDS: CommandDef[] = [
  { id: 'ref', label: 'Reference', sub: 'Link to a document or heading', keywords: 'reference ref link document doc heading anchor' },
]

// Detect the active slash context at the caret: a `/` that starts at a line start or after whitespace,
// followed by the (whitespace-free) query up to the caret. Returns null when there's no such token
// (e.g. the caret moved past a space) — which is how the menu knows to dismiss while leaving the text.
function slashContext(state: EditorState): { from: number; query: string } | null {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const before = state.sliceDoc(line.from, head)
  const m = /(^|\s)\/(\S*)$/.exec(before)
  if (!m) return null
  return { from: line.from + m.index + m[1].length, query: m[2] }
}

// Commands matching the typed query (matched against the label and the keyword list).
function buildCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase()
  return COMMANDS.filter((c) => !q || c.label.toLowerCase().includes(q) || c.keywords.includes(q)).map((c) => ({
    id: c.id,
    label: c.label,
    sub: c.sub,
  }))
}

function SaveIndicator({
  status,
  savedAt,
  onRetry,
}: {
  status: SaveStatus
  savedAt: Date | null
  onRetry: () => void
}) {
  if (status === 'saving')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    )
  if (status === 'error')
    return (
      <button
        className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-destructive"
        onClick={onRetry}
      >
        <AlertCircle className="size-3.5" /> Save failed — retry
      </button>
    )
  if (status === 'saved')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-emerald-600 dark:text-emerald-400">
        <Check className="size-3.5" /> Saved{savedAt ? ` ${savedAt.toLocaleTimeString()}` : ''}
      </span>
    )
  return <span className="inline-flex h-4 items-center text-xs" />
}

// Memoized so preview/status re-renders never touch CodeMirror (no flicker).
const SourceEditor = memo(function SourceEditor({
  cmRef,
  value,
  theme,
  extensions,
  onChange,
  onCreateEditor,
}: {
  cmRef: RefObject<ReactCodeMirrorRef | null>
  value: string
  theme: Extension
  extensions: Extension[]
  onChange: (v: string) => void
  onCreateEditor: (view: EditorView) => void
}) {
  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      theme={theme}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={onCreateEditor}
      basicSetup={BASIC_SETUP}
      height="100%"
      className="min-h-0 flex-1 overflow-hidden"
    />
  )
})

export default function Editor({
  doc,
  showPreview,
  onContentChange,
}: {
  doc: DocumentRec
  showPreview: boolean
  onContentChange?: (content: string) => void
}) {
  const { theme } = useTheme()
  const qc = useQueryClient()
  const cmRef = useRef<ReactCodeMirrorRef>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Captured once (state initializer) so CodeMirror's value never resets on cache updates.
  const [initialValue] = useState(doc.content)
  const latest = useRef(doc.content)
  const dirty = useRef(false)
  const uploadCounter = useRef(0)
  const [preview, setPreview] = useState(doc.content)
  const deferredPreview = useDeferredValue(preview)
  const previewImages = useSignedImages(deferredPreview)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [inTable, setInTable] = useState(false)
  const [inImage, setInImage] = useState(false)
  const [imageWidth, setImageWidth] = useState<number | null>(null)
  const [dropHint, setDropHint] = useState<{ line: number; col: number; x: number; y: number } | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const previewTimer = useRef<number | undefined>(undefined)
  const previewRef = useRef<HTMLDivElement>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)

  // Slash flow state. Stage 1 (`slash`) is the in-document command menu — a passive overlay; focus
  // stays in CodeMirror, the typed `/query` lives in the document, and the editor keymap drives it.
  // Choosing a command removes the `/query` text and opens stages 2–3 (`refPicker`, a focused popover).
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [active, setActive] = useState(0)
  const [refPicker, setRefPicker] = useState<{ anchor: RefAnchor; from: number } | null>(null)
  const prevQueryRef = useRef<string | null>(null)

  // Mirrored into refs so the (stable) CodeMirror extension closures read the latest values at event
  // time without rebuilding the editor. `sessionRef` tracks an active slash session — started by a
  // freshly typed `/`, ended when the token is gone / Escape / accept — so a transient no-match hides
  // the dropdown without ending the session (deleting back into a match re-shows it).
  const sessionRef = useRef(false)
  const menuKeyRef = useRef<(key: string) => boolean>(() => false)

  const cmTheme: Extension = theme === 'dark' ? materialDark : materialLight

  const doSave = useCallback(async () => {
    if (!dirty.current) return
    const content = latest.current
    dirty.current = false
    setStatus('saving')
    const { data, error } = await supabase
      .from('documents')
      .update({ content })
      .eq('id', doc.id)
      .select()
      .single()
    if (error) {
      dirty.current = true
      setStatus('error')
      return
    }
    qc.setQueryData(treeKeys.document(doc.id), data) // keep cache fresh without a refetch
    // Also bump updated_at in the tree list so listings (e.g. the quick-notes page, which sorts by
    // it) reflect the edit immediately instead of after a manual refresh.
    const updatedAt = (data as DocumentRec).updated_at
    if (updatedAt) {
      qc.setQueryData<DocMeta[]>(treeKeys.documents, (old) =>
        old?.map((d) => (d.id === doc.id ? { ...d, updated_at: updatedAt } : d)),
      )
    }
    setStatus('saved')
    setSavedAt(new Date())
  }, [doc.id, qc])

  const handleChange = useCallback(
    (val: string) => {
      latest.current = val
      dirty.current = true
      window.clearTimeout(previewTimer.current)
      previewTimer.current = window.setTimeout(() => {
        setPreview(val)
        onContentChange?.(val)
      }, 150)
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void doSave(), 800)
    },
    [doSave, onContentChange],
  )

  // Flush on tab close (keepalive PATCH straight to PostgREST) and on unmount.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (!dirty.current) return
      fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${doc.id}`, {
        method: 'PATCH',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${getAccessToken() ?? SUPABASE_PUBLISHABLE_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ content: latest.current }),
      }).catch(() => {})
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.clearTimeout(saveTimer.current)
      window.clearTimeout(previewTimer.current)
      if (dirty.current) void doSave()
    }
  }, [doc.id, doSave])

  const uploadAndInsert = useCallback(
    async (file: File, pos?: number) => {
      const view = cmRef.current?.view
      if (!view) return
      const token = `![uploading…](#u${uploadCounter.current++})`
      const at = pos ?? view.state.selection.main.head
      view.dispatch({ changes: { from: at, insert: token }, selection: { anchor: at + token.length } })
      try {
        const path = await uploadImage(doc.project_id, file)
        const alt = file.name.replace(/\.[^.]+$/, '')
        const md = `![${alt}](storage:${path})`
        const idx = view.state.doc.toString().indexOf(token)
        if (idx >= 0) view.dispatch({ changes: { from: idx, to: idx + token.length, insert: md } })
      } catch (e) {
        const idx = view.state.doc.toString().indexOf(token)
        if (idx >= 0) view.dispatch({ changes: { from: idx, to: idx + token.length, insert: '' } })
        toast('error', 'Image upload failed: ' + (e instanceof Error ? e.message : 'error'))
      }
    },
    [doc.project_id],
  )

  // Keep the command menu in sync with the document/selection. A session starts on a freshly typed `/`
  // and ends when the slash token is gone or focus is lost; within a session the dropdown shows when a
  // command matches and hides (without ending the session) when none do, so the typed text always
  // stays put and deleting back into a match re-shows the menu.
  const syncSlash = useCallback((u: ViewUpdate) => {
    if (u.focusChanged && !u.view.hasFocus) {
      sessionRef.current = false
      setSlash(null)
      return
    }
    if (!u.docChanged && !u.selectionSet) return
    const head = u.state.selection.main.head
    const justTyped =
      u.docChanged &&
      u.transactions.some((t) => t.isUserEvent('input.type')) &&
      u.state.sliceDoc(Math.max(0, head - 1), head) === '/'
    if (justTyped) sessionRef.current = true
    const ctx = slashContext(u.state)
    if (!ctx) {
      sessionRef.current = false
      setSlash(null)
      return
    }
    if (!sessionRef.current) return
    const items = buildCommands(ctx.query)
    if (items.length === 0) {
      setSlash(null) // no match: hide the dropdown but keep the session alive
      return
    }
    const coords = u.view.coordsAtPos(ctx.from)
    setSlash((prev) => ({
      from: ctx.from,
      query: ctx.query,
      items,
      coords: coords ? { left: coords.left, top: coords.top, bottom: coords.bottom } : (prev?.coords ?? { left: 0, top: 0, bottom: 0 }),
    }))
    if (ctx.query !== prevQueryRef.current) setActive(0)
    prevQueryRef.current = ctx.query
  }, [])

  // Open the reference picker (stages 2–3) at `from`, having removed the `/query` text already.
  const openRefPicker = (view: EditorView, from: number) => {
    const coords = view.coordsAtPos(from)
    if (!coords) return
    setRefPicker({ anchor: { left: coords.left, top: coords.top, bottom: coords.bottom }, from })
  }

  // Execute the chosen command: remove the `/query` text and open the picker at the trigger position.
  const acceptSlash = (index: number) => {
    const view = cmRef.current?.view
    if (!view || !slash) return
    const cmd = slash.items[index]
    if (!cmd) return
    const from = slash.from
    const to = view.state.selection.main.head
    sessionRef.current = false
    setSlash(null)
    view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } })
    // cmd.id === 'ref' is the only command today; all open the reference picker.
    openRefPicker(view, from)
  }

  // Picker confirmed: insert `[text](href)` at the trigger position, text pre-selected for renaming.
  const handleRefPick = (r: { text: string; href: string }) => {
    const view = cmRef.current?.view
    if (view && refPicker) {
      const from = refPicker.from
      view.dispatch({
        changes: { from, to: from, insert: `[${r.text}](${r.href})` },
        selection: EditorSelection.range(from + 1, from + 1 + r.text.length),
      })
      requestAnimationFrame(() => view.focus())
    }
    setRefPicker(null)
  }

  const handleRefClose = () => {
    setRefPicker(null)
    requestAnimationFrame(() => cmRef.current?.view?.focus())
  }

  // Keyboard while the menu is open: returns true to consume the key (so CodeMirror doesn't move the
  // caret / insert a newline); false when the menu is closed (let CodeMirror handle it).
  const menuKey = (key: string): boolean => {
    if (!slash) return false
    if (key === 'ArrowDown') {
      setActive((i) => Math.min(i + 1, slash.items.length - 1))
      return true
    }
    if (key === 'ArrowUp') {
      setActive((i) => Math.max(i - 1, 0))
      return true
    }
    if (key === 'Enter' || key === 'Tab') {
      acceptSlash(Math.min(active, slash.items.length - 1))
      return true
    }
    if (key === 'Escape') {
      sessionRef.current = false
      setSlash(null)
      return true
    }
    return false
  }
  // Refreshed every render so the keymap closure calls the latest handler (current state captured).
  useEffect(() => {
    menuKeyRef.current = menuKey
  })

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      cmChrome,
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged || u.focusChanged) {
          // Image and table contexts are mutually exclusive; the image toolbar takes precedence.
          const img = parseImageAt(u.view)
          setInImage(!!img)
          setImageWidth(img?.width ?? null)
          setInTable(img ? false : isInTable(u.view))
        }
      }),
      // Custom slash reference menu: this high-priority keymap drives the overlay while it's open
      // (consuming arrows/enter/escape); the listener keeps it in sync as the doc/selection change.
      // Refs are read at event time, not during render — false positive.
      /* eslint-disable react-hooks/refs */
      Prec.highest(
        keymap.of(
          ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].map((key) => ({ key, run: () => menuKeyRef.current(key) })),
        ),
      ),
      EditorView.updateListener.of((u) => syncSlash(u)),
      /* eslint-enable react-hooks/refs */
      // These handlers read the editor ref at event time, not during render — false positive.
      // eslint-disable-next-line react-hooks/refs
      EditorView.domEventHandlers({
        drop: (event, view) => {
          setDropHint(null)
          const files = event.dataTransfer?.files
          if (!files || files.length === 0) return false
          const image = Array.from(files).find((f) => f.type.startsWith('image/'))
          if (!image) return false
          event.preventDefault()
          const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
          void uploadAndInsert(image, at)
          return true
        },
        dragover: (event, view) => {
          if (!event.dataTransfer?.types?.includes('Files')) return false
          event.preventDefault()
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos == null) return false
          view.dispatch({ selection: { anchor: pos } })
          const line = view.state.doc.lineAt(pos)
          setDropHint({ line: line.number, col: pos - line.from + 1, x: event.clientX, y: event.clientY })
          return true
        },
        dragleave: () => {
          setDropHint(null)
          return false
        },
        dragend: () => {
          setDropHint(null)
          return false
        },
      }),
    ],
    [uploadAndInsert, syncSlash],
  )

  // Toolbar "@" button: insert a `/` at the caret and open the reference menu explicitly.
  // Toolbar "@" button: open the reference picker directly at the caret (skips the command stage —
  // clicking the button is itself choosing the "Reference" command).
  const handleRefClick = useCallback(() => {
    const view = cmRef.current?.view
    if (!view) return
    const head = view.state.selection.main.head
    const coords = view.coordsAtPos(head)
    if (!coords) {
      view.focus()
      return
    }
    setRefPicker({ anchor: { left: coords.left, top: coords.top, bottom: coords.bottom }, from: head })
  }, [])

  // Flip the source `- [ ]` ↔ `- [x]` for the toggled task. `index` is the checkbox's position in
  // the rendered preview (document order); we scan lines and skip fenced code blocks so a literal
  // `- [ ]` inside a code block — which renders as text, not a checkbox — doesn't shift the count.
  const toggleTask = useCallback((index: number) => {
    const view = cmRef.current?.view
    if (!view) return
    const doc = view.state.doc
    const taskRe = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]/
    let inFence = false
    let fenceChar = ''
    let i = 0
    for (let ln = 1; ln <= doc.lines; ln++) {
      const line = doc.line(ln)
      const fence = line.text.match(/^\s*(`{3,}|~{3,})/)
      if (fence) {
        const ch = fence[1][0]
        if (!inFence) {
          inFence = true
          fenceChar = ch
        } else if (ch === fenceChar) {
          inFence = false
        }
        continue
      }
      if (inFence) continue
      const m = line.text.match(taskRe)
      if (!m) continue
      if (i === index) {
        const at = line.from + m[1].length + 1
        view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' } })
        return
      }
      i++
    }
  }, [])

  // Commit a new width to the Nth image (document order) — driven by the preview's drag handle.
  // We don't touch the editor selection: the gesture happened in the preview pane, not the source.
  const handleResizeImage = useCallback((index: number, width: number) => {
    const view = cmRef.current?.view
    if (!view) return
    const tok = findImages(view.state.doc.toString())[index]
    if (!tok) return
    const md = imageMarkdown(tok.alt, tok.url, tok.title, clampImageWidth(width))
    view.dispatch({ changes: { from: tok.from, to: tok.to, insert: md } })
  }, [])

  // Toolbar +/- on the image under the cursor. When the image has no explicit width yet, seed from
  // its rendered size in the preview (so the first step grows/shrinks from what's on screen), falling
  // back to a default in edit-only mode where there is no preview. The cursor is kept inside the token
  // so repeated presses keep the image toolbar active.
  const stepImageWidth = useCallback((dir: 1 | -1) => {
    const view = cmRef.current?.view
    if (!view) return
    const tok = parseImageAt(view)
    if (!tok) return
    let base = tok.width
    if (base == null) {
      const tokens = findImages(view.state.doc.toString())
      const idx = tokens.findIndex((t) => t.from === tok.from)
      const el = idx >= 0 ? previewRef.current?.querySelectorAll<HTMLImageElement>('.md img')[idx] : undefined
      base = el?.clientWidth || 400
    }
    const md = imageMarkdown(tok.alt, tok.url, tok.title, stepWidth(base, dir))
    const rel = Math.min(Math.max(0, view.state.selection.main.head - tok.from), md.length)
    view.dispatch({ changes: { from: tok.from, to: tok.to, insert: md }, selection: EditorSelection.cursor(tok.from + rel) })
    view.focus()
  }, [])

  const resetImageWidth = useCallback(() => {
    const view = cmRef.current?.view
    if (!view) return
    const tok = parseImageAt(view)
    if (!tok) return
    const md = imageMarkdown(tok.alt, tok.url, tok.title, null)
    const rel = Math.min(Math.max(0, view.state.selection.main.head - tok.from), md.length)
    view.dispatch({ changes: { from: tok.from, to: tok.to, insert: md }, selection: EditorSelection.cursor(tok.from + rel) })
    view.focus()
  }, [])

  const handleCreateEditor = useCallback((view: EditorView) => setScroller(view.scrollDOM), [])

  // Split mode: anchor the source and preview panes so they scroll together (proportional mapping).
  useEffect(() => {
    const left = scroller
    const right = previewRef.current
    if (!showPreview || !left || !right) return
    let active: HTMLElement | null = null
    let raf = 0
    const sync = (src: HTMLElement, dst: HTMLElement) => {
      const sMax = src.scrollHeight - src.clientHeight
      const dMax = dst.scrollHeight - dst.clientHeight
      if (sMax <= 0 || dMax <= 0) return
      dst.scrollTop = (src.scrollTop / sMax) * dMax
    }
    const release = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        active = null
      })
    }
    const onLeft = () => {
      if (active === right) return
      active = left
      sync(left, right)
      release()
    }
    const onRight = () => {
      if (active === left) return
      active = right
      sync(right, left)
      release()
    }
    left.addEventListener('scroll', onLeft, { passive: true })
    right.addEventListener('scroll', onRight, { passive: true })
    return () => {
      left.removeEventListener('scroll', onLeft)
      right.removeEventListener('scroll', onRight)
      cancelAnimationFrame(raf)
    }
  }, [showPreview, scroller])

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void uploadAndInsert(file)
    e.target.value = ''
  }

  return (
    // Fill the scroll area's full height (the parent has a definite height); the editor and preview
    // panes manage their own internal scrolling, so the page itself doesn't scroll in edit/split.
    // The toolbar spans the full width above BOTH panes so the source and rendered content line up at
    // the same y (it used to sit inside the left pane only, shifting the preview up relative to it).
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/40 px-2.5 py-1.5">
        <EditorToolbar
          getView={() => cmRef.current?.view ?? null}
          onImageClick={() => fileInputRef.current?.click()}
          onRefClick={handleRefClick}
          inTable={inTable}
          inImage={inImage}
          imageWidth={imageWidth}
          onImageWider={() => stepImageWidth(1)}
          onImageNarrower={() => stepImageWidth(-1)}
          onImageResetSize={resetImageWidth}
        />
        <SaveIndicator
          status={status}
          savedAt={savedAt}
          onRetry={() => {
            dirty.current = true
            void doSave()
          }}
        />
      </div>
      <div className={cn('flex min-h-0 flex-1', showPreview ? 'max-md:flex-col' : '')}>
        <div
          className={cn(
            'flex min-w-0 flex-col',
            showPreview ? 'flex-1 basis-1/2 border-r border-border max-md:border-r-0 max-md:border-b' : 'flex-1',
          )}
          onBlur={() => void doSave()}
        >
          <SourceEditor
            cmRef={cmRef}
            value={initialValue}
            theme={cmTheme}
            extensions={extensions}
            onChange={handleChange}
            onCreateEditor={handleCreateEditor}
          />
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onFilePicked} />
        </div>
        {showPreview && (
          <div ref={previewRef} className="min-h-0 min-w-0 flex-1 basis-1/2 overflow-y-auto px-7 pt-4 pb-20">
            <Markdown
              images={previewImages}
              onToggleTask={toggleTask}
              onResizeImage={handleResizeImage}
              scrollRoot={() => previewRef.current}
            >
              {deferredPreview}
            </Markdown>
          </div>
        )}
      </div>
      {dropHint && (
        <div
          className="pointer-events-none fixed z-60 rounded bg-primary px-2 py-0.5 font-mono text-[0.72rem] text-primary-foreground shadow-md"
          style={{ left: dropHint.x + 14, top: dropHint.y + 14 }}
        >
          Ln {dropHint.line}, Col {dropHint.col}
        </div>
      )}
      {slash && (
        <SlashMenu
          state={slash}
          active={Math.min(active, slash.items.length - 1)}
          onHover={setActive}
          onPick={acceptSlash}
        />
      )}
      {refPicker && (
        <RefPicker
          anchor={refPicker.anchor}
          projectId={doc.project_id}
          content={preview}
          onPick={handleRefPick}
          onClose={handleRefClose}
        />
      )}
    </div>
  )
}
