import { Link, useParams } from 'react-router-dom'
import { useQuickNotes } from '../hooks/useQuickNotes'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Button } from '@/components/ui/button'
import { notesPath } from '../lib/paths'
import { docLabel } from '../lib/labels'
import { APP_NAME } from '../lib/brand'
import DocumentBody from './DocumentBody'

// /:workspace/notes/:id — a single quick note. Quick notes live in the user's own workspace, so the
// owner can always edit them. Resolution is by the note's nanoid slug.
export default function QuickNoteDetail() {
  const { projectSlug, id } = useParams()
  const { workspace, findNote } = useQuickNotes()
  const note = findNote(id)

  // Tab title is the quick note's display title (its creation date while still untitled).
  useDocumentTitle(note ? docLabel(note) : APP_NAME)

  if (!workspace || projectSlug !== workspace.slug || !note) {
    return (
      <div className="mx-auto mt-[12vh] max-w-xl px-6 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight">Not found</h1>
        <p className="mb-6 leading-relaxed text-muted-foreground">
          This quick note doesn’t exist, or you don’t have access to it.
        </p>
        <Button variant="outline" asChild>
          <Link to={workspace ? notesPath(workspace.slug) : '/'}>Go to quick notes</Link>
        </Button>
      </div>
    )
  }

  return <DocumentBody meta={note} canEdit />
}
