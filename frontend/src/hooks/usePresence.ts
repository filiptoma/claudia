import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { listMentionableUsers } from '../lib/crud'
import type { MentionableUser } from '../lib/types'

// A user currently viewing the document, resolved for display. Display fields come from the
// AUTHORITATIVE member directory (list_mentionable_users), never from the tracked payload — a client
// can only assert its own uid, not impersonate another user's name/avatar (anti-spoof, security-first).
export interface PresentUser {
  uid: string
  name: string | null
  email: string | null
  avatarUrl: string | null
  /** Earliest time any of this user's tabs joined (for a stable left-to-right order). */
  joinedAt: number
  isSelf: boolean
}

// The only thing a client is trusted to assert about itself. Name/avatar are resolved separately.
interface TrackPayload {
  uid: string
  joinedAt: number
}

/**
 * Subscribes to the per-document presence channel `doc:<id>` (private, JWT-gated by the RLS policies in
 * migration 0026 — only users who can VIEW the doc can join or observe). Tracks a tiny self payload and
 * returns the deduplicated list of viewers. Presence requires being signed in; logged-out visitors pass
 * a null uid and get an empty list (and never appear to others).
 *
 * Message cost is negligible: join / leave / heartbeat only — no per-keystroke traffic.
 */
export function usePresence(docId: string | null, projectId: string | null) {
  const { uid } = useAuth()
  const [raw, setRaw] = useState<{ uid: string; joinedAt: number }[]>([])

  // Authoritative display directory for this project (owner + members + grantees), cached and shared
  // with the mentions UI. Used only to resolve uid → name/avatar; the gate is the RLS, not this list.
  const directory = useQuery({
    queryKey: ['mentionable-users', projectId],
    enabled: !!projectId && !!uid,
    staleTime: 5 * 60 * 1000,
    queryFn: () => listMentionableUsers(projectId as string),
  })

  useEffect(() => {
    if (!docId || !uid) return
    let cancelled = false
    // key: uid collapses a user's multiple tabs into a single presence entry → one avatar.
    const channel: RealtimeChannel = supabase.channel(`doc:${docId}`, {
      config: { private: true, presence: { key: uid } },
    })

    const sync = () => {
      if (cancelled) return
      const state = channel.presenceState<TrackPayload>()
      const list = Object.keys(state).map((key) => {
        const metas = state[key]
        const joinedAt = Math.min(...metas.map((m) => m.joinedAt ?? Number.MAX_SAFE_INTEGER))
        return { uid: key, joinedAt: Number.isFinite(joinedAt) ? joinedAt : Date.now() }
      })
      setRaw(list)
    }

    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)

    // No explicit supabase.realtime.setAuth() here: supabase-js already keeps the realtime socket's JWT
    // current (it calls setAuth on SIGNED_IN / TOKEN_REFRESHED), so the private channel carries the
    // token automatically. Calling setAuth() on mount forces EVERY joined channel to re-auth and rejoin
    // — and StrictMode runs this effect twice per mount, on each window — which made presence flicker in
    // and out as the channels churned. Just subscribe.
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({ uid, joinedAt: Date.now() } satisfies TrackPayload)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Most likely the realtime.messages RLS policies (migration 0026) aren't applied, so the private
        // channel is rejected. Surface it instead of failing silently (no avatars, no clue).
        console.warn(`[presence] doc:${docId} channel ${status}`, err ?? '')
      }
    })

    return () => {
      cancelled = true
      setRaw([]) // drop the prior doc's viewers so a doc switch doesn't flash stale avatars
      // removeChannel() unsubscribes AND untracks; calling untrack() too is a redundant second "leave"
      // that widens the subscribe/teardown race under StrictMode's mount→unmount→mount.
      void supabase.removeChannel(channel)
    }
  }, [docId, uid])

  const directoryById = useMemo(() => {
    const m = new Map<string, MentionableUser>()
    for (const u of directory.data ?? []) m.set(u.id, u)
    return m
  }, [directory.data])

  const users = useMemo<PresentUser[]>(() => {
    return raw
      .map((p) => {
        const info = directoryById.get(p.uid)
        return {
          uid: p.uid,
          name: info?.name ?? null,
          email: info?.email ?? null,
          avatarUrl: info?.avatar_url ?? null,
          joinedAt: p.joinedAt,
          isSelf: p.uid === uid,
        }
      })
      .sort((a, b) => a.joinedAt - b.joinedAt)
  }, [raw, directoryById, uid])

  return { users, count: users.length }
}
