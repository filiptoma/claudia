import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LinkIcon } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTree } from '../hooks/useTree'
import { redeemInvite } from '../lib/crud'
import { docPath, folderPath, projectPath } from '../lib/paths'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import type { RedeemResult } from '../lib/types'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import LoginModal from './LoginModal'

function targetPath(r: RedeemResult): string {
  const slug = r.project_slug ?? ''
  if (r.kind === 'folder' && r.folder_slug) return folderPath(slug, r.folder_slug)
  if (r.kind === 'document' && r.document_slug) return docPath(slug, r.folder_slug, r.document_slug)
  return projectPath(slug)
}

export default function InvitePage() {
  const { token } = useParams()
  const { uid, loading: authLoading } = useAuth()
  const { refresh } = useTree()
  const navigate = useNavigate()
  useDocumentTitle('Invitation')

  const [error, setError] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  // Redeem at most once per mount, even under React 18 StrictMode double-invoke.
  const redeemed = useRef(false)

  useEffect(() => {
    if (authLoading || !uid || !token || redeemed.current) return
    redeemed.current = true
    void (async () => {
      try {
        const result = await redeemInvite(token)
        await refresh() // reveal the now-accessible resource before we navigate to it
        navigate(targetPath(result), { replace: true })
      } catch (e) {
        redeemed.current = false
        setError(e instanceof Error ? e.message : 'This invite link is invalid')
      }
    })()
  }, [authLoading, uid, token, refresh, navigate])

  return (
    <div className="mx-auto mt-[14vh] max-w-md px-6 text-center">
      <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <LinkIcon className="size-6" />
      </div>

      {!authLoading && !uid ? (
        <>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">You’ve been invited</h1>
          <p className="mb-6 text-muted-foreground">Sign in or create an account to accept this invitation.</p>
          <Button onClick={() => setShowLogin(true)}>Sign in to continue</Button>
          {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
        </>
      ) : error ? (
        <>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">Invite unavailable</h1>
          <p className="mb-6 text-muted-foreground">{error}</p>
          <Button variant="outline" asChild>
            <Link to="/">Go home</Link>
          </Button>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">Accepting invitation…</h1>
          <div className="mt-4 flex justify-center">
            <Spinner />
          </div>
        </>
      )}
    </div>
  )
}
