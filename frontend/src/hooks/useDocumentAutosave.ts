import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, getAccessToken, supabase } from '../lib/supabase'
import { treeKeys } from './useTree'
import type { DocMeta } from './useTree'
import { useSaveStatus } from '../lib/saveStatus'
import type { DocumentRec } from '../lib/types'

// Debounced autosave for a document's `content`, factored out of the markdown Editor so the LaTeX
// editor shares the exact same save semantics: an 800 ms debounce after the last keystroke, the
// `saveStatus` store wired to the app-bar SaveIndicator (with a retry handler), a keepalive PATCH on
// tab close, and a flush on blur/unmount. The markdown Editor still owns its richer save path (it is
// interleaved with suggestion mode + the preview pipeline), so it is deliberately left untouched.
//
// Usage: feed every CodeMirror change into `onChange(value)`; call `flush()` to persist immediately
// (e.g. the editor's onBlur). `latest` always holds the most recent content (handy for compiling).
export function useDocumentAutosave(doc: Pick<DocumentRec, 'id' | 'content'>) {
  const qc = useQueryClient()
  const latest = useRef(doc.content)
  const dirty = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)

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
    // Bump updated_at in the tree list too so listings reflect the edit immediately.
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

  const onChange = useCallback(
    (val: string) => {
      latest.current = val
      dirty.current = true
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void doSave(), 800)
    },
    [doSave],
  )

  // Persist now if there are unsaved edits (called on blur).
  const flush = useCallback(() => {
    if (dirty.current) void doSave()
  }, [doSave])

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
      if (dirty.current) void doSave()
    }
  }, [doc.id, doSave])

  return { latest, onChange, flush }
}
