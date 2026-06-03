import type { ReactNode } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FilePlus, FolderPlus, Pencil, Plus, Settings, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTree } from '../hooks/useTree'
import { useTreeActions } from '../hooks/useTreeActions'
import { useRouteContext } from '../hooks/useRouteContext'
import { useQuickNotes } from '../hooks/useQuickNotes'
import { canConfigureProject, canEditProject, projectVisibility } from '../lib/access'
import { docSplitPath, folderPath, notesPath, noteSplitPath, projectPath, projectSettingsPath } from '../lib/paths'
import { docLabel, formatDateTime } from '../lib/labels'
import { Button } from '@/components/ui/button'
import Breadcrumbs from './Breadcrumbs'
import type { Crumb } from './Breadcrumbs'
import ActionsMenu from './ActionsMenu'
import type { MenuAction } from './ActionsMenu'
import ModeSwitch from './ModeSwitch'
import type { Mode } from './ModeSwitch'
import { DocIcon, FolderGlyph, ProjectGlyph, QuickNoteIcon } from './EntityIcons'

const ICON_CLS = 'size-4 shrink-0 text-muted-foreground'

export default function AppHeader() {
  const { project, folder, doc, projectSlug } = useRouteContext()
  const location = useLocation()
  const navigate = useNavigate()
  const { role, uid } = useAuth()
  const { members, folders } = useTree()
  const actions = useTreeActions()
  const [searchParams, setSearchParams] = useSearchParams()

  const params = useParams()
  const { workspace, findNote } = useQuickNotes()

  const memberCount = useMemo(
    () => (project ? members.filter((m) => m.project_id === project.id).length : 0),
    [members, project],
  )

  // The ModeSwitch only renders for editors, who default to split. We set the param explicitly (no
  // delete-on-view) so that switching to View sticks — an absent param now means split, not view.
  const mode = ((searchParams.get('mode') as Mode) || 'split') as Mode
  const setMode = (m: Mode) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('mode', m)
        return next
      },
      { replace: true },
    )
  }

  // ----- quick notes (/:workspace/notes, /:workspace/notes/:id) -----
  // No folder/doc slug is ever exactly "notes" (they carry nanoids), so this segment is unambiguous.
  if (location.pathname.split('/')[2] === 'notes') {
    const wsSlug = workspace?.slug ?? location.pathname.split('/')[1]
    const workspaceCrumb: Crumb = workspace
      ? {
          label: workspace.name,
          to: projectPath(workspace.slug),
          icon: <ProjectGlyph project={workspace} visibility="private" className={ICON_CLS} />,
        }
      : { label: wsSlug }
    const notesCrumb = (last: boolean): Crumb => ({
      label: 'Quick notes',
      to: last ? undefined : notesPath(wsSlug),
      icon: <QuickNoteIcon className={ICON_CLS} />,
    })

    const noteId = params.id
    if (noteId) {
      const note = findNote(noteId)
      if (!note) {
        return <HeaderShell items={[workspaceCrumb, notesCrumb(false), { label: 'Not found' }]} />
      }
      const items: Crumb[] = [
        workspaceCrumb,
        notesCrumb(false),
        {
          label: docLabel(note),
          icon: <QuickNoteIcon className={ICON_CLS} />,
          editable: {
            id: note.id,
            value: note.title,
            placeholder: formatDateTime(note.created_at),
            onSubmit: (v) => void actions.submitDocTitle(note, v),
          },
        },
      ]
      const menu: MenuAction[] = [
        { label: 'Rename', icon: <Pencil />, onSelect: () => void actions.editDocument(note) },
        {
          label: 'Delete',
          icon: <Trash2 />,
          danger: true,
          onSelect: async () => {
            if (await actions.deleteDocument(note)) navigate(notesPath(wsSlug))
          },
        },
      ]
      return (
        <HeaderShell
          items={items}
          actions={
            <>
              <ModeSwitch mode={mode} onChange={setMode} />
              <ActionsMenu alwaysVisible label="Note actions" actions={menu} />
            </>
          }
        />
      )
    }
    // notes list
    const onNew = async () => {
      const note = await actions.newQuickNote()
      if (note) navigate(noteSplitPath(wsSlug, note.slug))
    }
    return (
      <HeaderShell
        items={[workspaceCrumb, notesCrumb(true)]}
        actions={
          workspace ? (
            <Button size="sm" onClick={() => void onNew()}>
              <Plus /> New quick note
            </Button>
          ) : null
        }
      />
    )
  }

  // ----- top-level (non-project) pages -----
  if (!projectSlug) {
    let items: Crumb[] = [{ label: 'Dashboard' }]
    if (location.pathname === '/profile') items = [{ label: 'Profile' }]
    else if (location.pathname === '/admin') items = [{ label: 'Admin' }]
    else if (location.pathname === '/admin/users') items = [{ label: 'Admin', to: '/admin' }, { label: 'Users' }]
    else if (location.pathname === '/admin/projects')
      items = [{ label: 'Admin', to: '/admin' }, { label: 'All projects' }]
    return <HeaderShell items={items} />
  }

  if (!project) {
    return <HeaderShell items={[{ label: projectSlug }]} />
  }

  const myMemberRole = members.find((m) => m.project_id === project.id && m.user_id === uid)?.role
  const canEdit = canEditProject(project, role, uid, myMemberRole)
  const canConfigure = canConfigureProject(project, role, uid)
  const isSettings = location.pathname === projectSettingsPath(project.slug)
  const visibility = projectVisibility(project, memberCount)

  // The project crumb keeps its icon (workspace glyph or visibility) in every view.
  const projectCrumb: Crumb = {
    label: project.name,
    to: projectPath(project.slug),
    icon: <ProjectGlyph project={project} visibility={visibility} className={ICON_CLS} />,
  }

  // ----- /:project/settings -----
  if (isSettings) {
    return <HeaderShell items={[projectCrumb, { label: 'Settings' }]} />
  }

  // ----- document view -----
  if (doc) {
    const items: Crumb[] = [projectCrumb]
    if (folder) items.push({ label: folder.name, to: folderPath(project.slug, folder.slug), icon: <FolderGlyph className={ICON_CLS} /> })
    items.push({
      label: docLabel(doc),
      icon: <DocIcon className={ICON_CLS} />,
      editable: canEdit
        ? { id: doc.id, value: doc.title, placeholder: 'Untitled note', onSubmit: (v) => void actions.submitDocTitle(doc, v) }
        : undefined,
    })
    const menu: MenuAction[] = [
      { label: 'Rename', icon: <Pencil />, onSelect: () => void actions.editDocument(doc) },
      {
        label: 'Delete',
        icon: <Trash2 />,
        danger: true,
        onSelect: async () => {
          if (await actions.deleteDocument(doc))
            navigate(folder ? folderPath(project.slug, folder.slug) : projectPath(project.slug))
        },
      },
    ]
    return (
      <HeaderShell
        items={items}
        actions={
          canEdit ? (
            <>
              <ModeSwitch mode={mode} onChange={setMode} />
              <ActionsMenu alwaysVisible label="Document actions" actions={menu} />
            </>
          ) : null
        }
      />
    )
  }

  // ----- folder view -----
  if (folder) {
    const items: Crumb[] = [
      projectCrumb,
      {
        label: folder.name,
        icon: <FolderGlyph className={ICON_CLS} />,
        editable: canEdit
          ? { id: folder.id, value: folder.name, onSubmit: (v) => void actions.submitFolderName(folder, v) }
          : undefined,
      },
    ]
    const menu: MenuAction[] = [
      { label: 'Rename folder', icon: <Pencil />, onSelect: () => void actions.editFolder(folder) },
      {
        label: 'Delete folder',
        icon: <Trash2 />,
        danger: true,
        onSelect: async () => {
          if (await actions.deleteFolder(folder)) navigate(projectPath(project.slug))
        },
      },
    ]
    return (
      <HeaderShell
        items={items}
        actions={
          canEdit ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const d = await actions.newDocument(project, folder.id)
                  if (d) navigate(docSplitPath(project.slug, d, folders))
                }}
              >
                <FilePlus /> New document
              </Button>
              <ActionsMenu alwaysVisible label="Folder actions" actions={menu} />
            </>
          ) : null
        }
      />
    )
  }

  // ----- project root view -----
  const overflow: MenuAction[] = canConfigure
    ? [
        { label: 'Rename project', icon: <Pencil />, onSelect: () => void actions.editProject(project) },
        { label: 'Settings', icon: <Settings />, onSelect: () => navigate(projectSettingsPath(project.slug)) },
        {
          label: 'Delete project',
          icon: <Trash2 />,
          danger: true,
          onSelect: async () => {
            if (await actions.deleteProject(project)) navigate('/')
          },
        },
      ]
    : []
  return (
    <HeaderShell
      items={[projectCrumb]}
      actions={
        canEdit ? (
          <>
            <Button size="sm" variant="outline" onClick={() => void actions.newFolder(project)}>
              <FolderPlus /> New folder
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                const d = await actions.newDocument(project, null)
                if (d) navigate(docSplitPath(project.slug, d, folders))
              }}
            >
              <FilePlus /> New document
            </Button>
            <ActionsMenu alwaysVisible label="Project actions" actions={overflow} />
          </>
        ) : null
      }
    />
  )
}

function HeaderShell({ items, actions }: { items: Crumb[]; actions?: ReactNode }) {
  return (
    <header className="flex h-13 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-sm max-md:pl-16">
      <Breadcrumbs items={items} />
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
