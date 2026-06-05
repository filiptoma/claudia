import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import AppLayout from './components/AppLayout'
import AppToaster from './components/AppToaster'
import Home from './components/Home'
import ProjectScreen from './components/ProjectScreen'
import ProjectSettings from './components/ProjectSettings'
import AdminDashboard from './components/AdminDashboard'
import AdminUsers from './components/AdminUsers'
import AdminProjects from './components/AdminProjects'
import AdminFeedback from './components/AdminFeedback'
import QuickNotesPage from './components/QuickNotesPage'
import QuickNoteDetail from './components/QuickNoteDetail'
import Profile from './components/Profile'
import UserProfilePage from './components/UserProfilePage'
import PublicProjectsPage from './components/PublicProjectsPage'
import BugPage from './components/BugPage'
import RequestPage from './components/RequestPage'
import { FullPageSpinner } from './components/ui/spinner'
import { useAuth } from './context/AuthContext'
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
  const { loading: authLoading } = useAuth()
  const tree = useTree()
  usePrefetchDocuments()

  // Whole-app gate: don't render the shell until the required initializations are ready — the
  // session/role (auth) AND the core tree the always-visible sidebar + routing depend on.
  const booting = authLoading || tree.loading

  return (
    <>
      <AppToaster />
      {booting ? (
        <FullPageSpinner />
      ) : (
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/explore" element={<PublicProjectsPage />} />
            <Route path="/users/:userId" element={<UserProfilePage />} />
            <Route path="/bug" element={<BugPage />} />
            <Route path="/request" element={<RequestPage />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/projects" element={<AdminProjects />} />
            <Route path="/admin/feedback" element={<AdminFeedback />} />
            <Route path="/:projectSlug" element={<ProjectScreen />} />
            <Route path="/:projectSlug/settings" element={<ProjectSettings />} />
            <Route path="/:projectSlug/notes" element={<QuickNotesPage />} />
            <Route path="/:projectSlug/notes/:id" element={<QuickNoteDetail />} />
            <Route path="/:projectSlug/:seg1" element={<ProjectScreen />} />
            <Route path="/:projectSlug/:seg1/:seg2" element={<ProjectScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </>
  )
}
