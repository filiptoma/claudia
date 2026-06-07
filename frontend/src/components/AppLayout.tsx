import { useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AppHeader from './AppHeader'
import { SidebarContext } from '../context/SidebarContext'
import { AnnotationRailContext } from '../context/AnnotationRailContext'
import { cn } from '@/lib/utils'

// Shell shared by every route: a full-width app bar (logo + sidebar toggle + breadcrumbs + actions)
// on top, with the collapsible sidebar and the scrollable <Outlet> below it. The sidebar's collapsed
// state lives in context so the app bar — which owns the toggle — and the sidebar stay in sync.
export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // Mirrors the document page's comments/suggestions rail open state (published by the annotation
  // engine) so the content region can reserve room for the docked rail instead of being overlaid.
  const [railOpen, setRailOpen] = useState(false)
  const sidebar = useMemo(
    () => ({
      collapsed,
      toggle: () => setCollapsed((c) => !c),
      openMobile: () => setDrawerOpen(true),
    }),
    [collapsed],
  )
  const rail = useMemo(() => ({ open: railOpen, setOpen: setRailOpen }), [railOpen])

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
            <main
              className={cn(
                'relative flex min-w-0 flex-1 flex-col overflow-hidden',
                // Dock the comments/suggestions rail: reserve its width (matching its w-74 xl:w-88) so
                // the document shifts left instead of sitting under it. The rail itself is fixed to this
                // same right-hand strip.
                'transition-[padding] duration-200 ease-in-out',
                railOpen && 'pr-74 xl:pr-88',
              )}
            >
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Outlet />
              </div>
            </main>
          </div>
        </div>
      </AnnotationRailContext.Provider>
    </SidebarContext.Provider>
  )
}
