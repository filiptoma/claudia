import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, RefObject } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { BasicSetupOptions, ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { materialDark, materialLight } from '@uiw/codemirror-theme-material'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { SUPABASE_ANON_KEY, SUPABASE_URL, getAccessToken, supabase } from '../lib/supabase'
import { uploadImage } from '../lib/storage'
import { isInTable } from '../lib/mdTable'
import { treeKeys, useSignedImages } from '../hooks/useTree'
import { useTheme } from '../context/ThemeContext'
import Markdown from './Markdown'
import EditorToolbar from './EditorToolbar'
import type { DocumentRec } from '../lib/types'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const BASIC_SETUP: BasicSetupOptions = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
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
      <span className="save-status">
        <Loader2 size={14} className="spin" /> Saving…
      </span>
    )
  if (status === 'error')
    return (
      <button className="save-status save-error" onClick={onRetry}>
        <AlertCircle size={14} /> Save failed — retry
      </button>
    )
  if (status === 'saved')
    return (
      <span className="save-status save-ok">
        <Check size={14} /> Saved{savedAt ? ` ${savedAt.toLocaleTimeString()}` : ''}
      </span>
    )
  return <span className="save-status" />
}

// Memoized so preview/status re-renders never touch CodeMirror (no flicker).
const SourceEditor = memo(function SourceEditor({
  cmRef,
  value,
  theme,
  extensions,
  onChange,
}: {
  cmRef: RefObject<ReactCodeMirrorRef | null>
  value: string
  theme: Extension
  extensions: Extension[]
  onChange: (v: string) => void
}) {
  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      theme={theme}
      extensions={extensions}
      onChange={onChange}
      basicSetup={BASIC_SETUP}
      height="100%"
      className="cm"
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

  const initialValue = useRef(doc.content)
  const latest = useRef(doc.content)
  const dirty = useRef(false)
  const uploadCounter = useRef(0)
  const [preview, setPreview] = useState(doc.content)
  const deferredPreview = useDeferredValue(preview)
  const previewImages = useSignedImages(deferredPreview)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [inTable, setInTable] = useState(false)
  const [dropHint, setDropHint] = useState<{ line: number; col: number; x: number; y: number } | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const previewTimer = useRef<number | undefined>(undefined)

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
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${getAccessToken() ?? SUPABASE_ANON_KEY}`,
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
        alert('Image upload failed: ' + (e instanceof Error ? e.message : 'error'))
      }
    },
    [doc.project_id],
  )

  const dropHandler = useRef<(e: DragEvent, view: EditorView) => boolean>(() => false)
  dropHandler.current = (event, view) => {
    setDropHint(null)
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) return false
    const image = Array.from(files).find((f) => f.type.startsWith('image/'))
    if (!image) return false
    event.preventDefault()
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
    void uploadAndInsert(image, at)
    return true
  }

  const dragOverHandler = useRef<(e: DragEvent, view: EditorView) => boolean>(() => false)
  dragOverHandler.current = (event, view) => {
    if (!event.dataTransfer?.types?.includes('Files')) return false
    event.preventDefault()
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos == null) return false
    view.dispatch({ selection: { anchor: pos } })
    const line = view.state.doc.lineAt(pos)
    setDropHint({ line: line.number, col: pos - line.from + 1, x: event.clientX, y: event.clientY })
    return true
  }

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged || u.focusChanged) setInTable(isInTable(u.view))
      }),
      EditorView.domEventHandlers({
        drop: (event, view) => dropHandler.current(event, view),
        dragover: (event, view) => dragOverHandler.current(event, view),
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
    [],
  )

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void uploadAndInsert(file)
    e.target.value = ''
  }

  return (
    <div className={`editor ${showPreview ? 'editor-split' : 'editor-full'}`}>
      <div className="editor-pane" onBlur={() => void doSave()}>
        <div className="editor-bar">
          <EditorToolbar
            getView={() => cmRef.current?.view ?? null}
            onImageClick={() => fileInputRef.current?.click()}
            inTable={inTable}
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
        <SourceEditor
          cmRef={cmRef}
          value={initialValue.current}
          theme={cmTheme}
          extensions={extensions}
          onChange={handleChange}
        />
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onFilePicked} />
      </div>
      {showPreview && (
        <div className="editor-preview">
          <Markdown images={previewImages}>{deferredPreview}</Markdown>
        </div>
      )}
      {dropHint && (
        <div className="drop-hint" style={{ left: dropHint.x + 14, top: dropHint.y + 14 }}>
          Ln {dropHint.line}, Col {dropHint.col}
        </div>
      )}
    </div>
  )
}
