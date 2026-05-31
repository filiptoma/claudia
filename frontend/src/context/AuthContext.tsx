import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { pb } from '../lib/pb'
import { effectiveRole } from '../lib/types'
import type { Role, UserRec } from '../lib/types'

interface RegisterData {
  email: string
  password: string
  passwordConfirm: string
  name: string
}

interface AuthCtx {
  user: UserRec | null
  role: Role
  isEditor: boolean
  isAdmin: boolean
  loginEmail: (identity: string, password: string) => Promise<void>
  loginOAuth: (provider: 'google' | 'github') => Promise<void>
  register: (data: RegisterData) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

const currentUser = (): UserRec | null =>
  pb.authStore.isValid ? (pb.authStore.record as unknown as UserRec) : null

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRec | null>(currentUser)

  useEffect(() => {
    // pb.authStore is not a React store; subscribe so login / logout / OAuth re-render the tree.
    const unsub = pb.authStore.onChange(() => setUser(currentUser()))
    return () => unsub()
  }, [])

  const value = useMemo<AuthCtx>(() => {
    const role = effectiveRole(user)
    return {
      user,
      role,
      isEditor: role === 'editor' || role === 'admin',
      isAdmin: role === 'admin',
      async loginEmail(identity, password) {
        await pb.collection('users').authWithPassword(identity, password)
      },
      async loginOAuth(provider) {
        await pb.collection('users').authWithOAuth2({ provider })
      },
      async register(data) {
        // emailVisibility:true so admins can see the email in the Users dashboard.
        await pb.collection('users').create({ ...data, emailVisibility: true })
        await pb.collection('users').authWithPassword(data.email, data.password)
      },
      logout() {
        pb.authStore.clear()
      },
    }
  }, [user])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used within AuthProvider')
  return c
}
