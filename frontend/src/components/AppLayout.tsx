import { useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AppHeader from './AppHeader'
import { SidebarContext } from '../context/SidebarContext'

// Shell shared by every route: a full-width app bar (logo + sidebar toggle + breadcrumbs + actions)
// on top, with the collapsible sidebar and the scrollable <Outlet> below it. The sidebar's collapsed
// state lives in context so the app bar — which owns the toggle — and the sidebar stay in sync.
export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const sidebar = useMemo(
    () => ({
      collapsed,
      toggle: () => setCollapsed((c) => !c),
      openMobile: () => setDrawerOpen(true),
    }),
    [collapsed],
  )

  return (
    <SidebarContext.Provider value={sidebar}>
      <div className="flex h-full flex-col overflow-hidden">
        <AppHeader />
        <div className="flex min-h-0 flex-1">
          <Sidebar drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
          {drawerOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] md:hidden"
              onClick={() => setDrawerOpen(false)}
            />
          )}
          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  )
}
