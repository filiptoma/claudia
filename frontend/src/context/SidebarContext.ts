import { createContext, useContext } from 'react'

export interface SidebarApi {
  /** Desktop sidebar collapsed (fully hidden, no icon rail) state. */
  collapsed: boolean
  /** Toggle the desktop sidebar collapsed state. */
  toggle: () => void
  /** Open the mobile drawer (the app bar's toggle uses this below the md breakpoint). */
  openMobile: () => void
}

// Lives in its own module so both the provider (AppLayout) and consumers (Sidebar, AppHeader) can
// import it without a circular dependency.
export const SidebarContext = createContext<SidebarApi>({
  collapsed: false,
  toggle: () => {},
  openMobile: () => {},
})

export function useSidebar(): SidebarApi {
  return useContext(SidebarContext)
}
