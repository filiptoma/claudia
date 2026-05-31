import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { setAccessToken, supabase } from '../lib/supabase'
import { isStaffRole } from '../lib/access'
import type { Profile, Role } from '../lib/types'

interface AuthCtx {
  user: Profile | null
  uid: string | null
  role: Role
  isStaff: boolean
  isAdmin: boolean
  loading: boolean
  loginEmail: (email: string, password: string) => Promise<void>
  loginOAuth: (provider: 'google' | 'github') => Promise<void>
  register: (data: { email: string; password: string; name: string }) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const sync = async (userId: string | null, token: string | null) => {
      setAccessToken(token)
      setUid(userId)
      if (!userId) {
        if (active) setUser(null)
        return
      }
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (active) setUser((data as Profile | null) ?? null)
    }

    supabase.auth.getSession().then(({ data }) => {
      const s = data.session
      void sync(s?.user.id ?? null, s?.access_token ?? null).finally(() => {
        if (active) setLoading(false)
      })
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void sync(session?.user.id ?? null, session?.access_token ?? null)
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
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name }, emailRedirectTo: window.location.origin },
        })
        if (error) throw new Error(error.message)
      },
      async logout() {
        await supabase.auth.signOut()
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
