import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, FilePlus, FolderPlus, Pencil, StickyNote, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTree } from '../hooks/useTree'
import { useTreeActions } from '../hooks/useTreeActions'
import { useRouteContext } from '../hooks/useRouteContext'
import { useQuickNotes } from '../hooks/useQuickNotes'
import { canEditProject } from '../lib/access'
import { docPathFromTree, folderPath, notesPath, noteSplitPath } from '../lib/paths'
import { docLabel } from '../lib/labels'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { APP_NAME } from '../lib/brand'
import { Button } from '@/components/ui/button'
import QuerySuspense from './QuerySuspense'
import ItemCard from './ItemCard'
import QuickNoteCard from './QuickNoteCard'
import { DocIcon, FolderGlyph, WorkspaceIcon } from './EntityIcons'
import type { MenuAction } from './ActionsMenu'
import type { DocMeta } from '../hooks/useTree'
import type { Folder } from '../lib/types'

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

// Up to 7 quick-note cards + the "View all" cell fill two rows of four on large screens.
const WORKSPACE_NOTE_LIMIT = 7

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

export default function ProjectHome() {
  const { project, folder: currentFolder, missing, projectSlug } = useRouteContext()
  const { role, uid } = useAuth()
  const { folders, documents, members, queries } = useTree()
  const { notes: workspaceNotes } = useQuickNotes()
  const actions = useTreeActions()
  const navigate = useNavigate()

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

        const folderCardMenu = (f: Folder): MenuAction[] =>
          canEdit
            ? [
                { label: 'New document', icon: <FilePlus />, onSelect: () => void onNewDoc(f.id) },
                { label: 'Rename', icon: <Pencil />, onSelect: () => void actions.editFolder(f) },
                { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => void actions.deleteFolder(f) },
              ]
            : []
        const docCardMenu = (d: DocMeta): MenuAction[] =>
          canEdit
            ? [
                { label: 'Rename', icon: <Pencil />, onSelect: () => void actions.editDocument(d) },
                { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => void actions.deleteDocument(d) },
              ]
            : []

        const folderCard = (f: Folder) => (
          <ItemCard
            key={f.id}
            icon={<FolderGlyph />}
            title={f.name}
            meta={`${docCount(f.id)} ${docCount(f.id) === 1 ? 'document' : 'documents'}`}
            onOpen={() => navigate(folderPath(project.slug, f.slug))}
            menu={folderCardMenu(f)}
          />
        )
        const docCard = (d: DocMeta) => (
          <ItemCard
            key={d.id}
            icon={<DocIcon />}
            title={docLabel(d)}
            onOpen={() => navigate(docPathFromTree(project.slug, d, folders))}
            menu={docCardMenu(d)}
          />
        )

        // ---- folder view ----
        if (currentFolder) {
          return (
            <div className="mx-auto w-full max-w-7xl px-8 pt-7 pb-24 max-md:px-5">
              {folderDocs.length === 0 ? (
                <EmptyState
                  icon={<FolderGlyph className="size-7" />}
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
                <div className={GRID}>{folderDocs.map(docCard)}</div>
              )}
            </div>
          )
        }

        // ---- workspace dashboard ----
        if (isWorkspace) {
          // In the workspace, root documents are the "files" (quick notes are filtered out above).
          const files = rootDocs
          const empty = projectFolders.length === 0 && files.length === 0 && workspaceNotes.length === 0
          return (
            <div className="mx-auto w-full max-w-7xl px-8 pt-7 pb-24 max-md:px-5">
              {canEdit && (
                <div className="mb-7 flex flex-wrap gap-2">
                  <Button onClick={() => void onNewQuickNote()}>
                    <StickyNote /> New quick note
                  </Button>
                  <Button variant="outline" onClick={() => void onNewDoc(null)}>
                    <FilePlus /> New document
                  </Button>
                  <Button variant="outline" onClick={() => void actions.newFolder(project)}>
                    <FolderPlus /> New folder
                  </Button>
                </div>
              )}

              {empty ? (
                <EmptyState
                  icon={<WorkspaceIcon className="size-7" />}
                  title="Your workspace is empty"
                  hint="Capture a quick note, or create your first document or folder."
                />
              ) : (
                <div className="flex flex-col gap-9">
                  {projectFolders.length > 0 && <Section title="Folders"><div className={GRID}>{projectFolders.map(folderCard)}</div></Section>}
                  {files.length > 0 && <Section title="Files"><div className={GRID}>{files.map(docCard)}</div></Section>}
                  {workspaceNotes.length > 0 && (
                    <Section title="Quick notes">
                      <div className={GRID}>
                        {workspaceNotes.slice(0, WORKSPACE_NOTE_LIMIT).map((n) => (
                          <QuickNoteCard key={n.id} note={n} workspaceSlug={project.slug} menu={docCardMenu(n)} />
                        ))}
                        <Link
                          to={notesPath(project.slug)}
                          className="group flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-4 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                        >
                          View all quick notes
                          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </div>
                    </Section>
                  )}
                </div>
              )}
            </div>
          )
        }

        // ---- regular project root ----
        const empty = projectFolders.length === 0 && rootDocs.length === 0
        return (
          <div className="mx-auto w-full max-w-7xl px-8 pt-7 pb-24 max-md:px-5">
            {empty ? (
              <EmptyState
                icon={<DocIcon className="size-7" />}
                title="This project is empty"
                hint={canEdit ? 'Create your first document to get started.' : 'There’s nothing here yet.'}
                actions={
                  canEdit && (
                    <>
                      <Button variant="outline" onClick={() => void actions.newFolder(project)}>
                        <FolderPlus /> New folder
                      </Button>
                      <Button onClick={() => void onNewDoc(null)}>
                        <FilePlus /> New document
                      </Button>
                    </>
                  )
                }
              />
            ) : (
              <div className="flex flex-col gap-9">
                {projectFolders.length > 0 && <Section title="Folders"><div className={GRID}>{projectFolders.map(folderCard)}</div></Section>}
                {rootDocs.length > 0 && <Section title="Documents"><div className={GRID}>{rootDocs.map(docCard)}</div></Section>}
              </div>
            )}
          </div>
        )
      })()}
    </QuerySuspense>
  )
}

function EmptyState({
  icon,
  title,
  hint,
  actions,
}: {
  icon: ReactNode
  title: string
  hint: string
  actions?: ReactNode
}) {
  return (
    <div className="mt-[8vh] flex flex-col items-center text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {icon}
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>
      {actions && <div className="mt-5 flex gap-2">{actions}</div>}
    </div>
  )
}
