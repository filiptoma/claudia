import { useEffect, useMemo, useRef, useState } from 'react'
import type { Extension } from '@codemirror/state'
import * as Y from 'yjs'
import { yCollab } from 'y-codemirror.next'
import { useAuth } from '../../context/AuthContext'
import { usePresenceContext } from '../../context/PresenceContext'
import { SupabaseYProvider, type CollabUser } from './SupabaseYProvider'
import { userColor, userColorLight } from './colors'
import { remoteCursorTheme } from './remoteCursorTheme'

// The leader writes the merged doc back to the DB (both the Yjs blob and documents.content) this long
// after the last change settles — long enough to coalesce a burst of edits, short enough to bound loss.
const PERSIST_DEBOUNCE_MS = 4000

export interface CollabBinding {
  /** True once a co-editing session is live AND synced — the editor should then let Yjs own the document. */
  active: boolean
  /** The yCollab CodeMirror extension to mount while active (null otherwise). Stable for a session. */
  extension: Extension | null
  /** The merged Y.Text — the editor seeds CodeMirror from this when it switches into collab mode. */
  ytext: Y.Text | null
}

export interface UseCollabArgs {
  docId: string
  /** Only real editors co-edit. Commenters (suggestion mode) and viewers never open the broadcast channel. */
  enabled: boolean
  /** Current editor text — used to seed/reconcile the CRDT on activation so no in-flight edit is dropped. */
  getLocalText: () => string
  /** Persist flat text to documents.content (reuses the editor's own save path). Runs on the LEADER only. */
  persistContent: (text: string) => Promise<void>
}

// Fold `target` into a Y.Text with a minimal single-range edit (same diff model as the editor's
// suggestion capture) rather than a full replace — a replace would clobber peers' concurrent edits.
// Used once at activation to reconcile the freshly-loaded CRDT with the live editor text.
function reconcileYText(ytext: Y.Text, target: string): void {
  const cur = ytext.toString()
  if (cur === target) return
  let start = 0
  while (start < cur.length && start < target.length && cur[start] === target[start]) start++
  let endCur = cur.length
  let endTarget = target.length
  while (endCur > start && endTarget > start && cur[endCur - 1] === target[endTarget - 1]) {
    endCur--
    endTarget--
  }
  ytext.doc?.transact(() => {
    if (endCur > start) ytext.delete(start, endCur - start)
    if (endTarget > start) ytext.insert(start, target.slice(start, endTarget))
  })
}

/**
 * Bridges Feature-1 presence to the Feature-2 co-editing provider.
 *
 * Safeguard 3 (the decisive one for the message budget): the broadcast provider exists ONLY while ≥2
 * people are present and this user is a real editor. Solo editing opens no channel → $0 of message
 * quota, while the doc still autosaves through the editor's normal path.
 *
 * Leader = the editor with the smallest uid among those actually in the session (elected from the collab
 * channel's awareness, not raw presence, so a read-only viewer can never be picked). The leader is the
 * single writer back to the DB, so N co-editors don't all hammer documents.content / document_collab.
 */
export function useCollab({ docId, enabled, getLocalText, persistContent }: UseCollabArgs): CollabBinding {
  const { uid, user } = useAuth()
  const { count } = usePresenceContext()
  const shouldCollab = enabled && !!uid && count >= 2

  const [provider, setProvider] = useState<SupabaseYProvider | null>(null)
  const [active, setActive] = useState(false)
  const [isLeader, setIsLeader] = useState(false)

  // Volatile callbacks/identity mirrored into refs so they're read at event time and never become
  // provider-lifecycle deps (which would tear down and rebuild the whole session on a keystroke). The
  // refs are refreshed in an effect (runs every commit, BEFORE the effects below in definition order, so
  // a provider created this commit reads up-to-date values) rather than during render.
  const displayName = user?.name || user?.email || 'Someone'
  const getLocalTextRef = useRef(getLocalText)
  const persistContentRef = useRef(persistContent)
  const isLeaderRef = useRef(false)
  const displayNameRef = useRef(displayName)
  useEffect(() => {
    getLocalTextRef.current = getLocalText
    persistContentRef.current = persistContent
    isLeaderRef.current = isLeader
    displayNameRef.current = displayName
  })

  // ---- provider lifecycle: create on (≥2 ∧ editor), tear down otherwise ----
  useEffect(() => {
    if (!shouldCollab || !uid) return
    const me: CollabUser = {
      uid,
      name: displayNameRef.current,
      color: userColor(uid),
      colorLight: userColorLight(uid),
    }
    const p = new SupabaseYProvider(docId, me)
    let cancelled = false
    void p.start(getLocalTextRef.current()).then(() => {
      if (cancelled) return
      // Fold in edits made during the async load, and reconcile a DB blob that diverged from the live
      // text, so switching into collab never drops the user's in-flight work.
      reconcileYText(p.ytext, getLocalTextRef.current())
      setActive(true)
    })
    setProvider(p)
    return () => {
      cancelled = true
      // Final leader flush BEFORE destroy() (which short-circuits persist once torn down), so the last
      // edits reach the DB even when this leader is the one closing the session.
      if (isLeaderRef.current) {
        const text = p.text()
        void (async () => {
          try {
            await p.persist()
            await persistContentRef.current(text)
          } catch {
            /* best-effort final flush */
          }
        })()
      }
      p.destroy()
      setActive(false)
      setProvider(null)
      setIsLeader(false)
    }
  }, [shouldCollab, docId, uid])

  // ---- leader election from the collab channel's awareness (the editors actually in the session) ----
  useEffect(() => {
    if (!provider || !uid) return
    const recompute = () => {
      let leader = uid
      provider.awareness.getStates().forEach((st) => {
        const u = (st as { user?: { uid?: unknown } }).user?.uid
        if (typeof u === 'string' && u < leader) leader = u
      })
      setIsLeader(leader === uid)
    }
    recompute()
    provider.awareness.on('change', recompute)
    return () => provider.awareness.off('change', recompute)
  }, [provider, uid])

  // ---- leader-only persistence: debounce-write the merged doc back to the DB on every change ----
  useEffect(() => {
    if (!provider || !active) return
    let timer: number | undefined
    const schedule = () => {
      if (!isLeaderRef.current) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (!isLeaderRef.current) return
        void provider
          .persist()
          .then(() => persistContentRef.current(provider.text()))
          .catch(() => {})
      }, PERSIST_DEBOUNCE_MS)
    }
    // Persist on ANY change (local OR remote): the leader is the single writer for everyone's edits.
    provider.ydoc.on('update', schedule)
    return () => {
      provider.ydoc.off('update', schedule)
      window.clearTimeout(timer)
    }
  }, [provider, active])

  // One yCollab extension per session (stable while the provider lives, so the editor's extension list
  // doesn't churn on every presence tick). The Y.UndoManager scopes Ctrl-Z to this user's own edits.
  const extension = useMemo<Extension | null>(() => {
    if (!provider) return null
    return [
      yCollab(provider.ytext, provider.awareness, { undoManager: new Y.UndoManager(provider.ytext) }),
      remoteCursorTheme, // wider hover hit-area on remote carets + app-font name labels
    ]
  }, [provider])

  return {
    active,
    extension: active ? extension : null,
    ytext: provider?.ytext ?? null,
  }
}
