import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useRouteContext } from '../hooks/useRouteContext'
import { usePresence } from '../hooks/usePresence'
import type { PresentUser } from '../hooks/usePresence'

export interface PresenceValue {
  /** Every signed-in user currently viewing the routed document (self included), oldest-join first. */
  users: PresentUser[]
  count: number
}

const PresenceCtx = createContext<PresenceValue>({ users: [], count: 0 })

/**
 * The app's single per-document presence subscription, mounted once in AppLayout (above both the
 * header and the routed document). Both the header's avatar stack (PresenceAvatars) and the editor's
 * co-editing gate (useCollab) read from THIS one channel.
 *
 * Why share rather than subscribe twice: two `supabase.channel('doc:<id>')` on the same private topic
 * is exactly the channel churn that made presence flicker (see usePresence's teardown note), and it
 * doubles the join/leave traffic. One subscription, fanned out via context, avoids both.
 *
 * The current document comes from the route — the same source the header already uses — so on
 * non-document routes there's no doc, usePresence no-ops, and the value is empty.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { doc } = useRouteContext()
  const { users, count } = usePresence(doc?.id ?? null, doc?.project_id ?? null)
  // `users` is referentially stable between renders (memoised inside usePresence), so this value only
  // changes identity when presence actually changes. Consumers (and only consumers) re-render then —
  // the layout/header subtree passed as `children` keeps its element identity and is left untouched.
  const value = useMemo<PresenceValue>(() => ({ users, count }), [users, count])
  return <PresenceCtx.Provider value={value}>{children}</PresenceCtx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePresenceContext(): PresenceValue {
  return useContext(PresenceCtx)
}
