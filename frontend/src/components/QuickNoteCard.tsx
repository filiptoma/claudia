import { useNavigate } from 'react-router-dom'
import ItemCard from './ItemCard'
import { QuickNoteIcon } from './EntityIcons'
import { docLabel, formatDateTime } from '../lib/labels'
import { notePath } from '../lib/paths'
import type { MenuAction } from './ActionsMenu'
import type { DocMeta } from '../hooks/useTree'

// A quick note's card title is its creation date by default, or its title once one is given;
// the subtitle is always the last-updated date.
export default function QuickNoteCard({
  note,
  workspaceSlug,
  menu = [],
}: {
  note: DocMeta
  workspaceSlug: string
  menu?: MenuAction[]
}) {
  const navigate = useNavigate()
  return (
    <ItemCard
      icon={<QuickNoteIcon />}
      title={docLabel(note)}
      meta={`Updated ${formatDateTime(note.updated_at)}`}
      onOpen={() => navigate(notePath(workspaceSlug, note.slug))}
      menu={menu}
      accent="indigo"
    />
  )
}
