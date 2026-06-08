import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { setAccessToken, supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { isStaffRole } from '../lib/access'
import { clearPdfCache } from '../lib/latex/pdfCache'
import type { Profile, Role } from '../lib/types'

// Wipe browser-stored data tied to the signed-in user on logout, so nothing personal lingers on a shared
// device. Supabase's own session token is removed by signOut(); this clears the compiled-PDF cache and
// sweeps any stray Supabase auth keys from local/session storage. Device-level prefs that aren't tied to
// the user (e.g. the saved theme) are deliberately preserved, as is the public, non-personal engine
// asset cache (expensive to re-download).
async function clearUserData(): Promise<void> {
  await clearPdfCache()
  for (const store of [localStorage, sessionStorage]) {
    try {
      for (const key of Object.keys(store)) {
        if (key.startsWith('sb-')) store.removeItem(key)
      }
    } catch {
      // storage may be unavailable (private mode, etc.) — ignore.
    }
  }
}

interface AuthCtx {
  user: Profile | null
  uid: string | null
  role: Role
  isStaff: boolean
  isAdmin: boolean
  loading: boolean
  loginEmail: (email: string, password: string) => Promise<void>
  loginOAuth: (provider: 'google' | 'github') => Promise<void>
  register: (data: { email: string; password: string; name: string }) => Promise<{ needsConfirmation: boolean }>
  logout: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const prevUid = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    let active = true

    // Fallback profile from the auth user's own metadata, used when the `profiles` row can't be
    // read (transient error / RLS race) so a persisted session never looks signed-out on reload.
    const fallbackProfile = (u: User): Profile => ({
      id: u.id,
      email: u.email ?? null,
      name: (u.user_metadata?.name as string | undefined) ?? null,
      role: 'basic',
      created_at: u.created_at ?? new Date().toISOString(),
      avatar_url: null,
    })

    const sync = async (authUser: User | null, token: string | null) => {
      setAccessToken(token)
      const nextUid = authUser?.id ?? null
      setUid(nextUid)
      // When the signed-in user actually changes (login / logout), drop all cached query data so
      // RLS-scoped lists (projects, folders, …) refetch with the new permissions. Skipped on the
      // very first sync and on token refreshes (uid unchanged).
      if (prevUid.current !== undefined && prevUid.current !== nextUid) {
        void queryClient.invalidateQueries()
      }
      prevUid.current = nextUid
      if (!authUser) {
        if (active) setUser(null)
        return
      }
      const { data } = await supabase.from('profiles').select('*').eq('id', authUser.id).single()
      if (active) setUser((data as Profile | null) ?? fallbackProfile(authUser))
    }

    supabase.auth.getSession().then(({ data }) => {
      const s = data.session
      void sync(s?.user ?? null, s?.access_token ?? null).finally(() => {
        if (active) setLoading(false)
      })
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void sync(session?.user ?? null, session?.access_token ?? null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthCtx>(() => {
    const role: Role = user?.role ?? 'basic'
    return {
      user,
      uid,
      role,
      isStaff: isStaffRole(role),
      isAdmin: role === 'admin',
      loading,
      async loginEmail(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw new Error(error.message)
      },
      async loginOAuth(provider) {
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: window.location.origin },
        })
        if (error) throw new Error(error.message)
      },
      async register({ email, password, name }) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name }, emailRedirectTo: window.location.origin },
        })
        if (error) throw new Error(error.message)
        // When email confirmation is required, signUp returns no session until the link is clicked.
        return { needsConfirmation: !data.session }
      },
      async logout() {
        await supabase.auth.signOut()
        await clearUserData()
      },
      async refreshProfile() {
        if (!uid) return
        const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
        if (data) setUser(data as Profile)
      },
    }
  }, [user, uid, loading])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used within AuthProvider')
  return c
}
