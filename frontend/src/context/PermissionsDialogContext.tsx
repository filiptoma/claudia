import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import PermissionsDialog from '../components/PermissionsDialog'
import type { PermissionsTarget } from '../components/PermissionsDialog'

// A single app-level "permissions" dialog, opened from any folder/document action menu (header,
// sidebar, cards) without each call site managing its own dialog state — mirrors DialogContext.
interface PermissionsDialogApi {
  open: (target: PermissionsTarget) => void
}

const Ctx = createContext<PermissionsDialogApi | null>(null)

export function PermissionsDialogProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<PermissionsTarget | null>(null)
  const open = useCallback((t: PermissionsTarget) => setTarget(t), [])

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {target && <PermissionsDialog target={target} onClose={() => setTarget(null)} />}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePermissionsDialog(): PermissionsDialogApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePermissionsDialog must be used within PermissionsDialogProvider')
  return c
}
