import { useEffect, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FilePlus, FolderPlus, Pencil, StickyNote, Trash2 } from 'lucide-react'
import { warmLatexEngine } from '../lib/latex/compiler'
import ViewAllCard from './ViewAllCard'
import { useAuth } from '../context/AuthContext'
import { useTree } from '../hooks/useTree'
import { useTreeActions } from '../hooks/useTreeActions'
import { useRouteContext } from '../hooks/useRouteContext'
import { useQuickNotes } from '../hooks/useQuickNotes'
import {
  canEditDocument,
  canEditFolder,
  canEditProject,
  documentGrantRole,
  folderGrantRole,
} from '../lib/access'
import { docPathFromTree, folderPath, notesPath, noteSplitPath } from '../lib/paths'
import { docLabel } from '../lib/labels'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { APP_NAME } from '../lib/brand'
import { Button } from '@/components/ui/button'
import QuerySuspense from './QuerySuspense'
import EntityCard from './EntityCard'
import QuickNoteCard from './QuickNoteCard'
import EmptyState from './EmptyState'
import PageLayout from './PageLayout'
import { DocIcon, FolderGlyph, WorkspaceIcon } from './EntityIcons'
import type { MenuAction } from './ActionsMenu'
import type { DocMeta } from '../hooks/useTree'
import type { Folder } from '../lib/types'
import { rectSortingStrategy } from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'
import { useIsTouch } from '../hooks/useIsTouch'
import { useReorder } from '../hooks/useReorder'
import { useReorderMode } from '../lib/reorderMode'
import Reorderable from './dnd/Reorderable'
import SortableItem from './dnd/SortableItem'
import DragGrip from './dnd/DragGrip'

// Wider, 3-up grid so longer titles wrap to two lines instead of truncating.
const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'

// Up to 5 quick-note cards + the "View all" cell fill two rows of three on large screens.
const WORKSPACE_NOTE_LIMIT = 5

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

function NotFound({ slug }: { slug?: string }) {
  return (
    <div className="mx-auto mt-[12vh] max-w-xl px-6 text-center">
      <h1 className="mb-3 text-3xl font-bold tracking-tight">Not found</h1>
      <p className="mb-6 leading-relaxed text-muted-foreground">
        {slug ? `“${slug}” doesn’t exist here, or you don’t have access to it.` : 'This page doesn’t exist.'}
      </p>
      <Button variant="outline" asChild>
        <Link to="/">Go to dashboard</Link>
      </Button>
    </div>
  )
}

// One reorderable grid cell. Non-touch: the whole cell is the drag surface (a 5px move starts a drag, a
// click still opens the card). Touch reorder mode: the card stops navigating and a grip on the right is
// the drag surface, so the list still scrolls. Disabled: a plain passthrough with no drag affordance.
function SortableCard({
  id,
  enabled,
  touchReorder,
  children,
}: {
  id: string
  enabled: boolean
  touchReorder: boolean
  children: ReactNode
}) {
  return (
    <SortableItem id={id} disabled={!enabled}>
      {({ setNodeRef, listeners, style, isDragging }) => (
        <div
          ref={setNodeRef}
          style={style}
          {...(enabled && !touchReorder ? listeners : {})}
          className={cn(
            'relative rounded-xl',
            enabled && !touchReorder && 'cursor-grab active:cursor-grabbing',
            // While dragging, the real cell is an invisible placeholder holding the slot — the lifted copy
            // is the DragOverlay — so the list reflows cleanly and there's no drop flash.
            isDragging && 'opacity-0',
          )}
        >
          {children}
          {touchReorder && (
            <DragGrip
              listeners={listeners}
              className="absolute top-1/2 right-2 z-2 size-9 -translate-y-1/2 rounded-md bg-background/80 shadow-sm ring-1 ring-border"
            />
          )}
        </div>
      )}
    </SortableItem>
  )
}

export default function ProjectHome() {
  const { project, folder: currentFolder, missing, projectSlug } = useRouteContext()
  const { role, uid } = useAuth()
  const { folders, documents, members, grants, queries } = useTree()
  const { notes: workspaceNotes } = useQuickNotes()
  const actions = useTreeActions()
  const navigate = useNavigate()
  const isTouch = useIsTouch()
  const reorderActive = useReorderMode((s) => s.active)
  const reorder = useReorder()

  // Warm the LaTeX engine the moment a LaTeX project is opened, so its expensive WASM + TeX Live boot
  // overlaps with browsing the file tree instead of blocking the first compile when a document opens.
  useEffect(() => {
    if (project?.type === 'latex') warmLatexEngine()
  }, [project?.id, project?.type])

  // Tab title: documents are handled by DocPage. A folder page reuses its project's title (folder
  // names aren't worth surfacing in the tab), so this resolves to the workspace ("My"), a regular
  // project's name, or the app name when nothing resolves.
  useDocumentTitle(!project || missing ? APP_NAME : project.is_workspace ? 'My' : project.name)

  return (
    <QuerySuspense queries={queries} loadingLabel="Loading project…">
      {(() => {
        if (!project || missing) return <NotFound slug={projectSlug} />

        const myMemberRole = members.find((m) => m.project_id === project.id && m.user_id === uid)?.role
        const canEdit = canEditProject(project, role, uid, myMemberRole)
        const isWorkspace = project.is_workspace
        // Drag-to-reorder is for editors only: always available on non-touch (drag a card directly), and
        // on touch only while "Change order" mode is on. touchReorder additionally swaps each card's
        // tap-to-open + ⋯ for a grip handle.
        const dndEnabled = canEdit && (!isTouch || reorderActive)
        const touchReorder = isTouch && reorderActive && canEdit

        const projectFolders = folders.filter((f) => f.project_id === project.id)
        // Quick notes are excluded from a project's documents — they live under /notes.
        const rootDocs = documents.filter((d) => d.project_id === project.id && !d.folder_id && !d.is_quick_note)
        const folderDocs = currentFolder ? documents.filter((d) => d.folder_id === currentFolder.id) : []
        const docCount = (folderId: string) => documents.filter((d) => d.folder_id === folderId).length

        const onNewDoc = async (folderId: string | null) => {
          const doc = await actions.newDocument(project, folderId)
          if (doc) navigate(docPathFromTree(project.slug, doc, folders) + '?mode=split')
        }
        const onNewQuickNote = async () => {
          const note = await actions.newQuickNote()
          if (note) navigate(noteSplitPath(project.slug, note.slug))
        }

        // Permissions are intentionally NOT offered here: folder/document access is managed only from
        // the Project settings page, so the card menu never duplicates an affordance that lives there.
        const folderCardMenu = (f: Folder): MenuAction[] => {
          const folderCanEdit = canEditFolder(project, f, role, uid, myMemberRole, folderGrantRole(grants, f.id, uid))
          return folderCanEdit
            ? [
                { label: 'New document', icon: <FilePlus />, onSelect: () => void onNewDoc(f.id) },
                { label: 'Rename', icon: <Pencil />, onSelect: () => void actions.editFolder(f) },
                { label: 'Delete', icon: <Trash2 />, danger: true, separatorBefore: true, onSelect: () => void actions.deleteFolder(f) },
              ]
            : []
        }
        const docCardMenu = (d: DocMeta, folder: Folder | null): MenuAction[] => {
          const docCanEdit = canEditDocument(project, d, folder, role, uid, myMemberRole, documentGrantRole(grants, d, uid))
          return docCanEdit
            ? [
                { label: 'Rename', icon: <Pencil />, onSelect: () => void actions.editDocument(d) },
                { label: 'Delete', icon: <Trash2 />, danger: true, separatorBefore: true, onSelect: () => void actions.deleteDocument(d) },
              ]
            : []
        }

        // Card visuals — shared by the grid cell (wrapped in SortableCard) and the drag overlay, so the
        // lifted copy matches exactly what you grabbed.
        const folderCardEl = (f: Folder, reordering: boolean) => (
          <EntityCard
            icon={<FolderGlyph />}
            title={f.name}
            meta={`${docCount(f.id)} ${docCount(f.id) === 1 ? 'document' : 'documents'}`}
            to={folderPath(project.slug, f.slug)}
            menu={folderCardMenu(f)}
            reordering={reordering}
          />
        )
        const docCardEl = (d: DocMeta, folder: Folder | null, reordering: boolean) => (
          <EntityCard
            icon={<DocIcon />}
            title={docLabel(d)}
            to={docPathFromTree(project.slug, d, folders)}
            menu={docCardMenu(d, folder)}
            reordering={reordering}
          />
        )

        // A reorderable grid for one sibling list (folders, or documents in a folder/root). Reorderable
        // owns the order and renders each cell via renderItem; the overlay reuses the same card visual
        // (sans grip) as the lifted copy. With dnd off it just renders the plain grid.
        const sortableGrid = <T extends { id: string; sort_order: number }>(
          table: 'folders' | 'documents',
          items: T[],
          renderEl: (item: T, reordering: boolean) => ReactNode,
        ) => (
          <div className={GRID}>
            <Reorderable
              items={items}
              strategy={rectSortingStrategy}
              enabled={dndEnabled}
              touch={isTouch}
              onReorder={(ordered) => void reorder(table, ordered)}
              renderItem={(it) => (
                <SortableCard key={it.id} id={it.id} enabled={dndEnabled} touchReorder={touchReorder}>
                  {renderEl(it, touchReorder)}
                </SortableCard>
              )}
              renderOverlay={(it) => <div className="cursor-grabbing">{renderEl(it, false)}</div>}
            />
          </div>
        )

        // ---- folder view ----
        if (currentFolder) {
          return (
            <PageLayout className="pt-7 max-md:pt-4">
              {folderDocs.length === 0 ? (
                <EmptyState
                  icon={<FolderGlyph />}
                  title="This folder is empty"
                  hint={canEdit ? 'Create your first document to get started.' : 'There’s nothing here yet.'}
                  actions={
                    canEdit && (
                      <Button onClick={() => void onNewDoc(currentFolder.id)}>
                        <FilePlus /> New document
                      </Button>
                    )
                  }
                />
              ) : (
                sortableGrid('documents', folderDocs, (d, r) => docCardEl(d, currentFolder, r))
              )}
            </PageLayout>
          )
        }

        // ---- workspace dashboard ----
        if (isWorkspace) {
          // In the workspace, root documents are the "files" (quick notes are filtered out above).
          const files = rootDocs
          const empty = projectFolders.length === 0 && files.length === 0 && workspaceNotes.length === 0
          return (
            <PageLayout className="pt-7 max-md:pt-4">
              {empty ? (
                <EmptyState
                  accent="indigo"
                  icon={<WorkspaceIcon />}
                  title="Your workspace is empty"
                  hint="Capture a quick note, or create your first document or folder."
                  actions={
                    canEdit && (
                      <>
                        <Button variant="accent" onClick={() => void onNewQuickNote()}>
                          <StickyNote /> New quick note
                        </Button>
                        <Button variant="soft" onClick={() => void onNewDoc(null)}>
                          <FilePlus /> New document
                        </Button>
                        <Button variant="soft" onClick={() => void actions.newFolder(project)}>
                          <FolderPlus /> New folder
                        </Button>
                      </>
                    )
                  }
                />
              ) : (
                <div className="flex flex-col gap-9">
                  {projectFolders.length > 0 && <Section title="Folders">{sortableGrid('folders', projectFolders, folderCardEl)}</Section>}
                  {files.length > 0 && <Section title="Files">{sortableGrid('documents', files, (d, r) => docCardEl(d, null, r))}</Section>}
                  {workspaceNotes.length > 0 && (
                    <Section title="Quick notes">
                      <div className={GRID}>
                        {workspaceNotes.slice(0, WORKSPACE_NOTE_LIMIT).map((n) => (
                          <QuickNoteCard key={n.id} note={n} workspaceSlug={project.slug} menu={docCardMenu(n, null)} />
                        ))}
                        <ViewAllCard to={notesPath(project.slug)} label="View all quick notes" />
                      </div>
                    </Section>
                  )}
                </div>
              )}
            </PageLayout>
          )
        }

        // ---- regular project root ----
        const empty = projectFolders.length === 0 && rootDocs.length === 0
        return (
          <PageLayout className="pt-7 max-md:pt-4">
            {empty ? (
              <EmptyState
                icon={<DocIcon />}
                title="This project is empty"
                hint={canEdit ? 'Create your first document to get started.' : 'There’s nothing here yet.'}
                actions={
                  canEdit && (
                    <>
                      <Button onClick={() => void onNewDoc(null)}>
                        <FilePlus /> New document
                      </Button>
                      <Button variant="soft" onClick={() => void actions.newFolder(project)}>
                        <FolderPlus /> New folder
                      </Button>
                    </>
                  )
                }
              />
            ) : (
              <div className="flex flex-col gap-9">
                {projectFolders.length > 0 && <Section title="Folders">{sortableGrid('folders', projectFolders, folderCardEl)}</Section>}
                {rootDocs.length > 0 && <Section title="Documents">{sortableGrid('documents', rootDocs, (d, r) => docCardEl(d, null, r))}</Section>}
              </div>
            )}
          </PageLayout>
        )
      })()}
    </QuerySuspense>
  )
}
