import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import AppHeader from './AppHeader'
import { Button } from '@/components/ui/button'

// Shell shared by every route: sidebar + a route-derived header (breadcrumbs + actions) above the
// scrollable <Outlet>.
export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Button
          variant="outline"
          size="icon"
          className="absolute top-2 left-3 z-20 size-9 md:hidden"
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
        <AppHeader />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
