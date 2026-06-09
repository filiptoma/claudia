import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTree } from '../hooks/useTree'
import { useRouteContext } from '../hooks/useRouteContext'
import { canCommentDocument, canEditDocument, canEditProject, documentGrantRole } from '../lib/access'
import { docLabel } from '../lib/labels'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { APP_NAME } from '../lib/brand'
import { Button } from '@/components/ui/button'
import DocumentBody from './DocumentBody'

export default function DocPage() {
  const { project, folder, doc: meta } = useRouteContext()
  const { role, uid } = useAuth()
  const { members, grants } = useTree()

  const myMemberRole = project
    ? members.find((m) => m.project_id === project.id && m.user_id === uid)?.role
    : undefined
  // On a private document/folder, the effective tier comes from the user's grant (0023).
  const grant = meta ? documentGrantRole(grants, meta, uid) : null
  // Markdown: effective access folds in the document's cap AND its parent folder's cap (0018/0020),
  // or the grant when the doc/folder is private. LaTeX: project-level only, no commenter tier (§3.4).
  const canEdit =
    project && meta
      ? project.type === 'latex'
        ? canEditProject(project, role, uid, myMemberRole)
        : canEditDocument(project, meta, folder, role, uid, myMemberRole, grant)
      : false
  const canComment =
    project?.type === 'latex'
      ? false
      : project && meta
        ? canCommentDocument(project, meta, folder, role, uid, myMemberRole, grant)
        : false

  // Tab title is the document's own title (covers regular docs and quick notes alike).
  useDocumentTitle(meta ? docLabel(meta) : APP_NAME)

  // Tree is loaded by the app-level gate, so an unresolved project/doc here is genuinely not-found.
  if (!project || !meta) {
    return (
      <div className="mx-auto mt-[12vh] max-w-xl px-6 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight">Not found</h1>
        <p className="mb-6 leading-relaxed text-muted-foreground">
          This document doesn’t exist, or you don’t have access to it.
        </p>
        <Button variant="outline" asChild>
          <Link to="/">Go home</Link>
        </Button>
      </div>
    )
  }

  return <DocumentBody meta={meta} project={project} canEdit={canEdit} canComment={canComment} />
}
