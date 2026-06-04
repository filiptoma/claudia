import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useQuickNotes } from '../hooks/useQuickNotes'
import { useTreeActions } from '../hooks/useTreeActions'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { noteSplitPath } from '../lib/paths'
import { Button } from '@/components/ui/button'
import QuickNoteCard from './QuickNoteCard'
import EmptyState from './EmptyState'
import { QuickNoteIcon } from './EntityIcons'
import type { MenuAction } from './ActionsMenu'
import type { DocMeta } from '../hooks/useTree'

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'

export default function QuickNotesPage() {
  const { projectSlug } = useParams()
  const { workspace, notes } = useQuickNotes()
  const actions = useTreeActions()
  const navigate = useNavigate()

  // The quick-notes list is part of the private workspace.
  useDocumentTitle('My')

  // Quick notes belong to the user's private workspace, so the URL must be /<workspace>/notes.
  if (!workspace || projectSlug !== workspace.slug) return <Navigate to="/" replace />

  const onNew = async () => {
    const note = await actions.newQuickNote()
    if (note) navigate(noteSplitPath(workspace.slug, note.slug))
  }

  const menu = (note: DocMeta): MenuAction[] => [
    { label: 'Rename', icon: <Pencil />, onSelect: () => void actions.editDocument(note) },
    { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => void actions.deleteDocument(note) },
  ]

  return (
    <div className="mx-auto w-full max-w-7xl px-8 pt-10 pb-24 max-md:px-5 max-md:pt-14">
      <div className="mb-6">
        <h1 className="text-[2rem] font-bold tracking-tight">Quick notes</h1>
        <p className="mt-1 text-muted-foreground">
          Jot things down without worrying about a title or where they go.
        </p>
      </div>

      {notes.length === 0 ? (
        <EmptyState
          accent="indigo"
          icon={<QuickNoteIcon />}
          title="No quick notes yet"
          hint="Capture a thought now and organize it later — or never."
          actions={
            <Button variant="accent" onClick={() => void onNew()}>
              <Plus /> New quick note
            </Button>
          }
        />
      ) : (
        <div className={GRID}>
          {notes.map((n) => (
            <QuickNoteCard key={n.id} note={n} workspaceSlug={workspace.slug} menu={menu(n)} />
          ))}
        </div>
      )}
    </div>
  )
}
