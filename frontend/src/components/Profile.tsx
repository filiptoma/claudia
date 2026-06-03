import { Link, Navigate, useNavigate } from 'react-router-dom'
import { LogOut, ShieldCheck, ArrowRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTree } from '../hooks/useTree'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

export default function Profile() {
  const { user, role, isStaff, isAdmin, loading, logout } = useAuth()
  const { refresh } = useTree()
  const navigate = useNavigate()

  useDocumentTitle('Profile')

  // Wait for the persisted session to resolve before deciding — otherwise a hard refresh on
  // /profile would bounce a signed-in user home while `user` is momentarily null.
  if (loading) return <div className="p-10 text-muted-foreground">Loading…</div>
  if (!user) return <Navigate to="/" replace />

  const onSignOut = async () => {
    await logout()
    await refresh()
    navigate('/')
  }

  return (
    <div className="mx-auto max-w-2xl px-8 pt-10 pb-20 max-md:px-5 max-md:pt-14">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Profile</h1>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{user.name || 'Unnamed'}</div>
          <div className="truncate text-sm text-muted-foreground">{user.email || 'No email on file'}</div>
        </div>

        <Separator className="my-5" />

        <dl className="grid grid-cols-[7rem_1fr] gap-y-3 text-sm">
          <dt className="text-muted-foreground">Role</dt>
          <dd>
            <Badge variant={role === 'admin' ? 'destructive' : role === 'mod' ? 'default' : 'secondary'}>
              {role}
            </Badge>
          </dd>
          <dt className="text-muted-foreground">Member since</dt>
          <dd>{new Date(user.created_at).toLocaleDateString()}</dd>
        </dl>

        <Separator className="my-5" />

        <Button variant="outline" onClick={() => void onSignOut()}>
          <LogOut /> Sign out
        </Button>
      </div>

      {isStaff && (
        <Link
          to="/admin"
          className="group mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">Admin dashboard</div>
            <div className="text-sm text-muted-foreground">
              {isAdmin ? 'Manage users and all projects' : 'Manage all projects'}
            </div>
          </div>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </Link>
      )}
    </div>
  )
}
