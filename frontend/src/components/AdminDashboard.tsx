import { Navigate } from 'react-router-dom'
import { Layers, MessageSquare, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useIsMobile } from '../hooks/useIsMobile'
import PageLayout from './PageLayout'
import PageHeader from './PageHeader'
import LinkCard from './LinkCard'

// Staff (mod + admin) landing page. Admins additionally manage users; both manage all projects.
export default function AdminDashboard() {
  const { isStaff, isAdmin } = useAuth()
  const isMobile = useIsMobile()
  useDocumentTitle('Admin')
  if (!isStaff || isMobile) return <Navigate to="/" replace />

  return (
    <PageLayout variant="medium">
      <PageHeader title="Admin" description="Manage the workspace." />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LinkCard
          to="/admin/projects"
          icon={<Layers />}
          title="All projects"
          description="Browse and manage every project."
        />
        {isAdmin && (
          <LinkCard
            to="/admin/users"
            icon={<Users />}
            title="Users"
            description="View accounts and roles."
          />
        )}
        <LinkCard
          to="/admin/feedback"
          icon={<MessageSquare />}
          title="Feedback"
          description="Bug reports and feature requests."
        />
      </div>
    </PageLayout>
  )
}
