import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Menu } from 'lucide-react'
import Sidebar from './components/Sidebar'
import Home from './components/Home'
import DocPage from './components/DocPage'
import AdminUsers from './components/AdminUsers'
import { fetchDocument, treeKeys, useTree } from './hooks/useTree'

// Warm the ['document', id] cache in the background so first navigations are instant too.
function usePrefetchDocuments() {
  const qc = useQueryClient()
  const { documents } = useTree()
  useEffect(() => {
    for (const d of documents.slice(0, 150)) {
      void qc.prefetchQuery({
        queryKey: treeKeys.document(d.id),
        queryFn: () => fetchDocument(d.id),
        staleTime: 5 * 60 * 1000,
      })
    }
  }, [documents, qc])
}

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  usePrefetchDocuments()
  return (
    <div className="app">
      <Sidebar drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      <main className="main">
        <button
          className="hamburger icon-btn"
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu size={20} />
        </button>
        <div className="main-scroll">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/:projectSlug/:docSlug" element={<DocPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
