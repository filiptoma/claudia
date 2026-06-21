import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { usePresenceContext } from '../../context/PresenceContext'
import { SupabaseYProvider } from './SupabaseYProvider'
import { userColor, userColorLight } from './colors'

// How often a read-only observer re-reads the canonical blob as a safety net (the leader persists every
// ~4s; broadcasts carry the instant path between polls). Also how it discovers a session seeded just
// after it joined.
const CANONICAL_POLL_MS = 3000

/**
 * Read-only live view of a co-edited document for a NON-editor surface (read mode / a viewer or
 * commenter who isn't the one typing). Mirrors the co-editing gate — only opens while ≥2 people are
 * present — and subscribes to the same `doc-collab:<id>` broadcast channel in receive-only mode (a
 * non-editor can't broadcast, and doesn't need to). Returns the live document text while a session is
 * active, or `null` when there's nothing live to show (so the caller renders its static content).
 *
 * It deliberately does NOT reuse useCollab: that one binds a CodeMirror editor and is editor-gated.
 * This is the passive counterpart, so a reader watches edits stream in without joining as a writer.
 */
export function useObservedDocument(docId: string, enabled: boolean, getFallback: () => string): string | null {
  const { uid } = useAuth()
  const { count } = usePresenceContext()
  const shouldObserve = enabled && !!uid && count >= 2

  const [liveText, setLiveText] = useState<string | null>(null)
  // Read at provider-construction time only (its identity must not churn the session on every render).
  const getFallbackRef = useRef(getFallback)
  useEffect(() => {
    getFallbackRef.current = getFallback
  })

  useEffect(() => {
    // Not observing: stay null (initial value, and the cleanup below resets it on observe→not-observe).
    if (!shouldObserve || !uid) return
    // name/colour are only ever used for the awareness caret, which an observer never sends — so they're
    // cosmetic here; uid is what RLS gates the receive on.
    const provider = new SupabaseYProvider(
      docId,
      { uid, name: 'observer', color: userColor(uid), colorLight: userColorLight(uid) },
      { readOnly: true },
    )
    let cancelled = false
    // Surface text only once a canonical blob has loaded (provider.ready) — never a half-applied doc;
    // until then the caller shows its static fallback.
    const sync = () => {
      if (!cancelled) setLiveText(provider.ready ? provider.ytext.toString() : null)
    }
    provider.ydoc.on('update', sync)
    void provider.start(getFallbackRef.current()).then(sync)
    const poll = setInterval(() => void provider.reloadCanonical().then(sync), CANONICAL_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(poll)
      provider.ydoc.off('update', sync)
      provider.destroy()
      setLiveText(null)
    }
  }, [shouldObserve, docId, uid])

  return liveText
}
