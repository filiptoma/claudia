import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowRight, Layers, MessageSquare, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useIsMobile } from '../hooks/useIsMobile'
import PageLayout from './PageLayout'
import PageHeader from './PageHeader'

function DashLink({
  to,
  icon,
  title,
  description,
}: {
  to: string
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-foreground [&_svg]:size-5">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  )
}

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
        <DashLink
          to="/admin/projects"
          icon={<Layers />}
          title="All projects"
          description="Browse and manage every project."
        />
        {isAdmin && (
          <DashLink
            to="/admin/users"
            icon={<Users />}
            title="Users"
            description="View accounts and roles."
          />
        )}
        <DashLink
          to="/admin/feedback"
          icon={<MessageSquare />}
          title="Feedback"
          description="Bug reports and feature requests."
        />
      </div>
    </PageLayout>
  )
}
