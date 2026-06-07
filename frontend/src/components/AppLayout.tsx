import { useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AppHeader from './AppHeader'
import { SidebarContext } from '../context/SidebarContext'
import { AnnotationRailContext } from '../context/AnnotationRailContext'

// Shell shared by every route: a full-width app bar (logo + sidebar toggle + breadcrumbs + actions)
// on top, with the collapsible sidebar and the scrollable <Outlet> below it. The sidebar's collapsed
// state lives in context so the app bar — which owns the toggle — and the sidebar stay in sync.
export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // The document page portals its docked comments/suggestions rail into this in-flow slot (a flex
  // sibling of <main>), so the rail shifts content aside like the nav sidebar instead of floating.
  const [railSlot, setRailSlot] = useState<HTMLDivElement | null>(null)
  const sidebar = useMemo(
    () => ({
      collapsed,
      toggle: () => setCollapsed((c) => !c),
      openMobile: () => setDrawerOpen(true),
    }),
    [collapsed],
  )
  const rail = useMemo(() => ({ slot: railSlot }), [railSlot])

  return (
    <SidebarContext.Provider value={sidebar}>
      <AnnotationRailContext.Provider value={rail}>
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
            {/* Docked comments/suggestions rail mounts here (portaled by the document page). Empty —
                hence zero width — on every other route and when the rail is closed. */}
            <div ref={setRailSlot} className="flex shrink-0" />
          </div>
        </div>
      </AnnotationRailContext.Provider>
    </SidebarContext.Provider>
  )
}
