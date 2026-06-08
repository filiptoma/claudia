import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, PencilLine, X } from 'lucide-react'
import { useIsMobile } from '../hooks/useIsMobile'
import { useMarkdownScrollSync } from '../hooks/useMarkdownScrollSync'
import type { ChangeEvent, RefObject } from 'react'
import { AnnotationContext } from '../context/AnnotationContext'
import { useAnnotationEngine } from '../hooks/useAnnotationEngine'
import AnnotationToolbar from './annotations/AnnotationToolbar'
import SuggestionComposer from './annotations/SuggestionComposer'
import CodeMirror from '@uiw/react-codemirror'
import type { BasicSetupOptions, ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView, keymap, scrollPastEnd } from '@codemirror/view'
import { EditorSelection, Prec } from '@codemirror/state'
import type { EditorState, Extension } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { materialDark, materialLight } from '@uiw/codemirror-theme-material'
import { useQueryClient } from '@tanstack/react-query'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, getAccessToken, supabase } from '../lib/supabase'
import { useSaveStatus } from '../lib/saveStatus'
import { uploadImage } from '../lib/storage'
import { isInTable } from '../lib/mdTable'
import { clampImageWidth, findImages, imageMarkdown, parseImageAt, stepWidth } from '../lib/mdImage'
import { treeKeys, useSignedImages } from '../hooks/useTree'
import type { DocMeta } from '../hooks/useTree'
import { useTheme } from '../context/ThemeContext'
import { toast } from '../lib/toast'
import { cn } from '@/lib/utils'
import { registerLiveDoc } from '../lib/liveDoc'
import { cmChrome, cmLightContrast } from '../lib/cmTheme'
import Markdown from './Markdown'
import EditorToolbar from './EditorToolbar'
import SlashMenu from './SlashMenu'
import type { SlashCommand, SlashState } from './SlashMenu'
import RefPicker from './RefPicker'
import type { RefAnchor } from './RefPicker'
import type { Anchor, DocumentRec } from '../lib/types'

interface PendingEdit {
  sourceStart: number
  sourceEnd: number
  originalMd: string
  suggestedMd: string
  anchor: Anchor
}

// Finds the minimal changed region between two strings and builds the suggestion anchor.
function computeEditCapture(original: string, suggested: string): PendingEdit | null {
  if (original === suggested) return null
  let start = 0
  while (start < original.length && start < suggested.length && original[start] === suggested[start]) start++
  let endOrig = original.length
  let endSugg = suggested.length
  while (endOrig > start && endSugg > start && original[endOrig - 1] === suggested[endSugg - 1]) {
    endOrig--
    endSugg--
  }
  return {
    sourceStart: start,
    sourceEnd: endOrig,
    originalMd: original.slice(start, endOrig),
    suggestedMd: suggested.slice(start, endSugg),
    anchor: {
      quote: original.slice(start, endOrig),
      prefix: original.slice(Math.max(0, start - 32), start),
      suffix: original.slice(endOrig, Math.min(original.length, endOrig + 32)),
    },
  }
}

const BASIC_SETUP: BasicSetupOptions = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  // We build our own slash reference menu; CodeMirror's autocomplete is not used.
  autocompletion: false,
}

// Desktop floating window top in split mode: clears the app header (52px) + the editor's formatting
// toolbar (~48px) + the preview pane's annotation toolbar (44px).
const SPLIT_FLOATING_TOP = 148

// Editor chrome (cmChrome) + the light-mode contrast layer (cmLightContrast) live in lib/cmTheme so
// the LaTeX source editor renders identical chrome.

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
  // Trigger on the '/' nearest the caret — including one typed straight after text ("something/"),
  // not only at line start or after whitespace. The query runs from that '/' to the caret and stops
  // at the next '/' or whitespace, so the closest slash is always the active one.
  const m = /\/([^\s/]*)$/.exec(before)
  if (!m) return null
  return { from: line.from + m.index, query: m[1] }
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
  suggestionMode = false,
  onCreateSuggestion,
}: {
  doc: DocumentRec
  showPreview: boolean
  onContentChange?: (content: string) => void
  /** True for commenters who cannot directly edit: keystrokes open a suggestion confirmation panel. */
  suggestionMode?: boolean
  onCreateSuggestion?: (args: {
    anchor: Anchor
    sourceStart: number
    sourceEnd: number
    originalMd: string
    suggestedMd: string
    note: string
    mentions: string[]
  }) => Promise<void>
}) {
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const cmRef = useRef<ReactCodeMirrorRef>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [toolbarOpen, setToolbarOpen] = useState(!isMobile)
  // Keep toolbar state in sync when the viewport crosses the mobile breakpoint. Adjusting state during
  // render (React's recommended alternative to a setState-in-effect) avoids an extra commit.
  const [wasMobile, setWasMobile] = useState(isMobile)
  if (wasMobile !== isMobile) {
    setWasMobile(isMobile)
    setToolbarOpen(!isMobile)
  }

  // Captured once (state initializer) so CodeMirror's value never resets on cache updates.
  const [initialValue] = useState(doc.content)
  const latest = useRef(doc.content)
  const dirty = useRef(false)
  // Tracks the last externally-applied content so we only reset CodeMirror on real outside changes
  // (e.g. a suggestion was approved), never on our own autosaves.
  const externalContent = useRef(doc.content)
  const uploadCounter = useRef(0)
  const [preview, setPreview] = useState(doc.content)
  const deferredPreview = useDeferredValue(preview)
  const previewImages = useSignedImages(deferredPreview)
  const [inTable, setInTable] = useState(false)
  const [inImage, setInImage] = useState(false)
  const [imageWidth, setImageWidth] = useState<number | null>(null)
  const [dropHint, setDropHint] = useState<{ line: number; col: number; x: number; y: number } | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const previewTimer = useRef<number | undefined>(undefined)
  const previewRef = useRef<HTMLDivElement>(null)

  // Line-anchored scroll sync (split mode): map the editor's top source line ↔ the matching preview
  // block. Both the CodeMirror view and the preview's scroll container are captured as state so the
  // effect re-runs once each is mounted. The view is stable, so the callback is memoised — otherwise it
  // would defeat SourceEditor's memo and rebuild the editor.
  const [cmView, setCmView] = useState<EditorView | null>(null)
  const [previewEl, setPreviewEl] = useState<HTMLDivElement | null>(null)
  const handleCreateEditor = useCallback((view: EditorView) => setCmView(view), [])
  useMarkdownScrollSync(showPreview, cmView, previewEl)

  // Slash flow state. Stage 1 (`slash`) is the in-document command menu — a passive overlay; focus
  // stays in CodeMirror, the typed `/query` lives in the document, and the editor keymap drives it.
  // Choosing a command removes the `/query` text and opens stages 2–3 (`refPicker`, a focused popover).
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [active, setActive] = useState(0)
  const [refPicker, setRefPicker] = useState<{ anchor: RefAnchor; from: number } | null>(null)
  const prevQueryRef = useRef<string | null>(null)

  // Suggestion mode state
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null)
  const [suggestionBusy, setSuggestionBusy] = useState(false)
  // Mobile suggestion sheet: measured height + the bottom scroll margin CodeMirror should reserve so
  // the edited line stays clear of the fixed sheet (read via ref at scroll time — see `extensions`).
  const suggestionSheetRef = useRef<HTMLDivElement>(null)
  const [suggestionSheetH, setSuggestionSheetH] = useState(0)
  const suggestionMarginRef = useRef(0)
  const sheetOpenRef = useRef(false)

  // Mirrored into refs so the (stable) CodeMirror extension closures read the latest values at event
  // time without rebuilding the editor. `sessionRef` tracks an active slash session — started by a
  // freshly typed `/`, ended when the token is gone / Escape / accept — so a transient no-match hides
  // the dropdown without ending the session (deleting back into a match re-shows it).
  const sessionRef = useRef(false)
  const menuKeyRef = useRef<(key: string) => boolean>(() => false)

  const cmTheme: Extension = theme === 'dark' ? materialDark : [materialLight, cmLightContrast]

  const doSave = useCallback(async () => {
    if (!dirty.current) return
    const content = latest.current
    dirty.current = false
    useSaveStatus.getState().set({ status: 'saving' })
    const { data, error } = await supabase
      .from('documents')
      .update({ content })
      .eq('id', doc.id)
      .select()
      .single()
    if (error) {
      dirty.current = true
      useSaveStatus.getState().set({ status: 'error' })
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
    useSaveStatus.getState().set({ status: 'saved', savedAt: new Date() })
  }, [doc.id, qc])

  // Surface autosave status in the app bar; register the retry handler and clear it on unmount.
  useEffect(() => {
    useSaveStatus.getState().set({
      retry: () => {
        dirty.current = true
        void doSave()
      },
    })
    return () => useSaveStatus.getState().reset()
  }, [doSave])

  // Expose the live (possibly-unsaved) source so the app-bar Export menu can read it — `latest` is a
  // ref, so this getter stays current without re-registering on every keystroke.
  useEffect(() => registerLiveDoc(doc.id, () => latest.current), [doc.id])

  const handleChange = useCallback(
    (val: string) => {
      latest.current = val
      window.clearTimeout(previewTimer.current)
      previewTimer.current = window.setTimeout(() => {
        setPreview(val)
        onContentChange?.(val)
      }, 150)
      if (suggestionMode) {
        // Don't save; track the edit diff for the suggestion panel instead.
        setPendingEdit(computeEditCapture(doc.content, val))
        return
      }
      dirty.current = true
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void doSave(), 800)
    },
    [doSave, onContentChange, suggestionMode, doc.content],
  )

  // Revert editor to saved content and clear the pending suggestion.
  const revertEditor = useCallback(() => {
    const view = cmRef.current?.view
    if (!view) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc.content } })
  }, [doc.content])

  const handleSubmitSuggestion = useCallback(
    async (suggestedMd: string, note: string, mentions: string[]) => {
      if (!pendingEdit || !onCreateSuggestion || suggestionBusy) return
      setSuggestionBusy(true)
      try {
        await onCreateSuggestion({
          anchor: pendingEdit.anchor,
          sourceStart: pendingEdit.sourceStart,
          sourceEnd: pendingEdit.sourceEnd,
          originalMd: pendingEdit.originalMd,
          suggestedMd,
          note,
          mentions,
        })
        toast('success', 'Suggestion submitted')
        revertEditor()
      } catch (e) {
        toast('error', e instanceof Error ? e.message : 'Failed to submit suggestion')
      } finally {
        setSuggestionBusy(false)
      }
    },
    [pendingEdit, onCreateSuggestion, suggestionBusy, revertEditor],
  )

  // ---- mobile suggestion sheet: keep the edited line visible above it ----
  const sheetOpen = isMobile && suggestionMode && !!pendingEdit
  // Measure the sheet (its diff grows as the edit grows) so CodeMirror reserves matching bottom margin.
  useLayoutEffect(() => {
    const el = suggestionSheetRef.current
    if (!sheetOpen || !el) {
      setSuggestionSheetH(0)
      return
    }
    setSuggestionSheetH(el.offsetHeight)
    const ro = new ResizeObserver(() => setSuggestionSheetH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [sheetOpen])
  // Mirror the reserved margin into the ref the scrollMargins extension reads at scroll time.
  useEffect(() => {
    suggestionMarginRef.current = sheetOpen ? suggestionSheetH + 12 : 0
  }, [sheetOpen, suggestionSheetH])
  // When the sheet first opens, lift the just-typed edit above it once (CodeMirror won't re-scroll on
  // its own after the async render that mounts the sheet).
  useEffect(() => {
    if (!sheetOpen) {
      sheetOpenRef.current = false
      return
    }
    if (sheetOpenRef.current || suggestionSheetH <= 0) return
    sheetOpenRef.current = true
    const view = cmRef.current?.view
    if (view) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) })
  }, [sheetOpen, suggestionSheetH])

  // When the saved content changes from OUTSIDE this editor (a suggestion was approved → applied), pull
  // it into CodeMirror so the change shows immediately without a refresh. Skip if we have unsaved edits
  // or a pending suggestion (don't clobber in-progress work) or if it's just our own autosave echo.
  useEffect(() => {
    const view = cmRef.current?.view
    if (!view || doc.content === externalContent.current) return
    externalContent.current = doc.content
    if (dirty.current || pendingEdit || view.state.doc.toString() === doc.content) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc.content } })
    setPreview(doc.content)
  }, [doc.content, pendingEdit])

  // Flush on tab close (keepalive PATCH straight to PostgREST) and on unmount.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (suggestionMode || !dirty.current) return
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
  }, [doc.id, doSave, suggestionMode])

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
      // Bottom breathing space so the last line can scroll up off the bottom edge (HackMD-style). In
      // split mode this also creates the end-of-doc region where the editor can scroll past while the
      // preview stays pinned at its bottom — useMarkdownScrollSync syncs to the editor's *natural*
      // bottom (last line at the viewport bottom), not into this slack.
      scrollPastEnd(),
      cmChrome,
      // Reserve bottom space equal to the mobile suggestion sheet so the cursor stays above it while
      // typing. Read via ref at scroll time, so the extension never rebuilds — false positive.
      // eslint-disable-next-line react-hooks/refs
      EditorView.scrollMargins.of(() => (suggestionMarginRef.current ? { bottom: suggestionMarginRef.current } : null)),
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


  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void uploadAndInsert(file)
    e.target.value = ''
  }

  return (
    // Fill the scroll area's full height (the parent has a definite height); the editor and preview
    // panes manage their own internal scrolling, so the page itself doesn't scroll in edit/split.
    // Each pane carries its own toolbar: the formatting toolbar sits above the source editor (left),
    // the comments/suggestions toolbar above the rendered preview (right). Both share the same min
    // height so source and rendered content line up at the same y — but the formatting toolbar is free
    // to grow taller (rather than clip) when its buttons wrap, e.g. the table controls.
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex min-h-0 flex-1', showPreview ? 'max-md:flex-col' : '')}>
        <div
          className={cn(
            'flex min-w-0 flex-col',
            showPreview ? 'flex-1 basis-1/2 border-r border-border max-md:border-r-0 max-md:border-b' : 'flex-1',
          )}
          onBlur={() => { if (!suggestionMode) void doSave() }}
        >
          <div className="shrink-0 border-b border-border bg-background">
            {isMobile ? (
              <>
                <div className="flex h-12 items-center">
                  <button
                    className="flex h-12 items-center gap-2 px-4 text-sm font-medium text-muted-foreground active:bg-card/80"
                    onClick={() => setToolbarOpen((o) => !o)}
                    aria-label={toolbarOpen ? 'Hide formatting toolbar' : 'Show formatting toolbar'}
                  >
                    <span>Format</span>
                    {toolbarOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  </button>
                </div>
                {toolbarOpen && (
                  <div className="overflow-x-auto border-t border-border px-2 pb-2 pt-1">
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
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-11 items-center px-2.5 py-1">
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
              </div>
            )}
          </div>
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
          <EditorPreview
            scrollRef={previewRef}
            onScrollContainer={setPreviewEl}
            docId={doc.id}
            projectId={doc.project_id}
            canEdit={!suggestionMode}
            content={deferredPreview}
            images={previewImages}
            onToggleTask={toggleTask}
            onResizeImage={handleResizeImage}
          />
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

      {/* Suggestion confirmation panel — shown when a commenter has made changes */}
      {suggestionMode && pendingEdit && (
        isMobile ? (
          /* Mobile: short fixed bottom sheet */
          <div
            ref={suggestionSheetRef}
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-border bg-background shadow-2xl"
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <PencilLine className="size-4 text-muted-foreground" />
                Suggest an edit
              </div>
              <button
                type="button"
                aria-label="Cancel suggestion"
                onClick={revertEditor}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <SuggestionPanelBody
              projectId={doc.project_id}
              pendingEdit={pendingEdit}
              busy={suggestionBusy}
              onSubmit={handleSubmitSuggestion}
              onCancel={revertEditor}
            />
          </div>
        ) : (
          /* Desktop: floating panel pinned to the top-right, matching the annotation floating window */
          <div
            className="fixed right-4 z-50 flex w-80 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
            style={{ top: SPLIT_FLOATING_TOP, maxHeight: `calc(100vh - ${SPLIT_FLOATING_TOP}px - 1rem)` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <PencilLine className="size-4 text-muted-foreground" />
                Suggest an edit
              </div>
              <button
                type="button"
                aria-label="Cancel suggestion"
                onClick={revertEditor}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <SuggestionPanelBody
              projectId={doc.project_id}
              pendingEdit={pendingEdit}
              busy={suggestionBusy}
              onSubmit={handleSubmitSuggestion}
              onCancel={revertEditor}
            />
          </div>
        )
      )}
    </div>
  )
}

// The split editor's right preview pane, wrapped with the annotations engine so a reviewer can
// highlight rendered text to comment/suggest, see existing highlights, and open the sidebar from the
// toolbar — the same UX as read mode (split mode is unavailable on phones, but reachable on tablets,
// where the annotation UI resolves to the touch combination: short bottom sheet + sidebar).
function EditorPreview({
  scrollRef,
  onScrollContainer,
  docId,
  projectId,
  canEdit,
  content,
  images,
  onToggleTask,
  onResizeImage,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  /** Reports the scroll container element to the parent (for the editor↔preview scroll sync). */
  onScrollContainer: (el: HTMLDivElement | null) => void
  docId: string
  projectId: string
  canEdit: boolean
  content: string
  images: Record<string, string>
  onToggleTask: (index: number) => void
  onResizeImage: (index: number, width: number) => void
}) {
  const docRef = useRef<HTMLDivElement>(null)
  // Stable callback ref: an inline arrow would be re-created each render, making React detach/reattach
  // (null → el) every time and needlessly tear down the scroll-sync effect. scrollRef/onScrollContainer
  // are both stable, so this is created once.
  const bindScroll = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el
      onScrollContainer(el)
    },
    [scrollRef, onScrollContainer],
  )
  const eng = useAnnotationEngine({
    docRef,
    docId,
    projectId,
    content,
    canEdit,
    canComment: true,
    floatingTop: SPLIT_FLOATING_TOP,
  })

  // On touch the focus UI is the short bottom sheet (vs the popover); pad the pane so its content can
  // scroll clear of it, mirroring read mode.
  const docPaddingBottom =
    eng.focusMode === 'sheet' && eng.activeKey && eng.focusSheetHeight > 0
      ? `${eng.focusSheetHeight + 24}px`
      : undefined

  return (
    <AnnotationContext.Provider value={eng.ctx}>
      {/* Toolbar sits OUTSIDE the scroll area (fixed, always visible — like the editor's formatting
          toolbar above CodeMirror), so it never hides on scroll and both panes' scroll viewports are the
          same height. */}
      <div className="flex min-h-0 min-w-0 flex-1 basis-1/2 flex-col">
        <AnnotationToolbar
          count={eng.pendingCount}
          onOpenSidebar={() => eng.ctx.setSidebarOpen(true)}
          content={content}
          autoHide={false}
        />
        <div ref={bindScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div
            ref={docRef}
            onClick={eng.onDocClick}
            // Cap the rendered text column (split mode only — read mode has its own wrapper). On a wide
            // pane this makes the preview narrower than the full-width monospace editor, so prose wraps
            // to more rows and the rendered preview ends up TALLER than the source. With top-line scroll
            // sync that's what lets the editor's last line float with space below at the bottom
            // (HackMD-style) rather than the editor running longer than the preview. Tune max-w to trade
            // column width for how much the editor floats.
            className="max-w-4xl px-7 pt-4 pb-20"
            style={docPaddingBottom ? { paddingBottom: docPaddingBottom } : undefined}
          >
            <Markdown
              images={images}
              annotate
              sourceLines
              suggestions={eng.suggestionDiffs}
              onToggleTask={onToggleTask}
              onResizeImage={onResizeImage}
              scrollRoot={() => scrollRef.current}
            >
              {content}
            </Markdown>
          </div>
        </div>
      </div>
      {eng.overlays}
    </AnnotationContext.Provider>
  )
}

function SuggestionPanelBody({
  projectId,
  pendingEdit,
  busy,
  onSubmit,
  onCancel,
}: {
  projectId: string
  pendingEdit: PendingEdit
  busy: boolean
  onSubmit: (suggestedMd: string, note: string, mentions: string[]) => void
  onCancel: () => void
}) {
  return (
    <div className="overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[50vh]">
      <SuggestionComposer
        projectId={projectId}
        originalMd={pendingEdit.originalMd}
        suggestedMd={pendingEdit.suggestedMd}
        busy={busy}
        submitLabel="Suggest"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  )
}
