import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilePlus,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Globe,
  Lock,
  Moon,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
  Users,
} from 'lucide-react'
import ProjectSettings from './ProjectSettings'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useTree } from '../hooks/useTree'
import type { DocMeta } from '../hooks/useTree'
import { useDialog } from '../context/DialogContext'
import LoginModal from './LoginModal'
import { canEditProject, canManageProject, projectVisibility } from '../lib/access'
import {
  createDocument,
  createFolder,
  createProject,
  removeRecord,
  renameDocument,
  renameFolder,
  renameProject,
} from '../lib/crud'
import type { Folder, MemberRole, Project } from '../lib/types'

const reportError = (e: unknown) => alert(e instanceof Error ? e.message : 'Action failed')

function VisibilityIcon({ v, size = 13 }: { v: string; size?: number }) {
  if (v === 'public') return <Globe size={size} />
  if (v === 'shared') return <Users size={size} />
  return <Lock size={size} />
}

export default function Sidebar({
  drawerOpen,
  onCloseDrawer,
}: {
  drawerOpen: boolean
  onCloseDrawer: () => void
}) {
  const { projects, folders, documents, members, refresh } = useTree()
  const { user, uid, role, isAdmin, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const dialog = useDialog()
  const navigate = useNavigate()
  const { projectSlug, docSlug } = useParams()

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showLogin, setShowLogin] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const lastSyncedSlug = useRef<string | undefined>(undefined)

  // Per-project access maps derived from the membership rows the user can see.
  const memberCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of members) m.set(x.project_id, (m.get(x.project_id) ?? 0) + 1)
    return m
  }, [members])
  const myRole = useMemo(() => {
    const m = new Map<string, MemberRole>()
    for (const x of members) if (x.user_id === uid) m.set(x.project_id, x.role)
    return m
  }, [members, uid])
  const canEdit = (p: Project) => canEditProject(p, role, uid, myRole.get(p.id))
  const canManage = (p: Project) => canManageProject(p, role, uid)
  const visOf = (p: Project) => projectVisibility(p, memberCount.get(p.id) ?? 0)

  useEffect(() => {
    const p = projects.find((x) => x.slug === projectSlug)
    if (projectSlug && p && projectSlug !== lastSyncedSlug.current) {
      lastSyncedSlug.current = projectSlug
      setSelectedProjectId(p.id)
    }
  }, [projectSlug, projects])

  const toggleCollapse = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId) ?? null
    : null

  // ---- actions ----
  const onCreateProject = () =>
    dialog
      .prompt({ title: 'New project', label: 'Project name', confirmText: 'Create' })
      .then((name) => (name && uid ? createProject(name, uid).then(() => refresh()) : undefined))
      .catch(reportError)

  const onRenameProject = (p: Project) =>
    dialog
      .prompt({ title: 'Rename project', label: 'Name', defaultValue: p.name, confirmText: 'Rename' })
      .then((name) => (name && name !== p.name ? renameProject(p.id, name).then(() => refresh()) : undefined))
      .catch(reportError)

  const onDeleteProject = (p: Project) => {
    const fcount = folders.filter((f) => f.project_id === p.id).length
    const dcount = documents.filter((d) => d.project_id === p.id).length
    return dialog
      .confirm({
        title: 'Delete project',
        message: `Delete “${p.name}” and its ${fcount} folder(s) and ${dcount} document(s)? This cannot be undone.`,
        confirmText: 'Delete',
        danger: true,
      })
      .then(async (ok) => {
        if (!ok) return
        await removeRecord('projects', p.id)
        if (selectedProjectId === p.id) setSelectedProjectId(null)
        await refresh()
        if (p.slug === projectSlug) navigate('/')
      })
      .catch(reportError)
  }

  const onCreateFolder = (p: Project) =>
    dialog
      .prompt({ title: 'New folder', label: 'Folder name', confirmText: 'Create' })
      .then((name) => (name ? createFolder(p.id, name).then(() => refresh()) : undefined))
      .catch(reportError)

  const onRenameFolder = (f: Folder) =>
    dialog
      .prompt({ title: 'Rename folder', label: 'Name', defaultValue: f.name, confirmText: 'Rename' })
      .then((name) => (name && name !== f.name ? renameFolder(f.id, name).then(() => refresh()) : undefined))
      .catch(reportError)

  const onDeleteFolder = (f: Folder) => {
    const dcount = documents.filter((d) => d.folder_id === f.id).length
    return dialog
      .confirm({
        title: 'Delete folder',
        message: `Delete folder “${f.name}” and its ${dcount} document(s)? This cannot be undone.`,
        confirmText: 'Delete',
        danger: true,
      })
      .then(async (ok) => {
        if (!ok) return
        const hadActive = documents.some(
          (d) => d.folder_id === f.id && d.slug === docSlug && d.project_id === f.project_id,
        )
        await removeRecord('folders', f.id)
        await refresh()
        if (hadActive) navigate('/')
      })
      .catch(reportError)
  }

  const onCreateDoc = (p: Project, folderId: string | null) =>
    dialog
      .prompt({ title: 'New document', label: 'Document title', confirmText: 'Create' })
      .then(async (title) => {
        if (!title) return
        const doc = await createDocument(p.id, folderId, title)
        await refresh()
        onCloseDrawer()
        navigate(`/${p.slug}/${doc.slug}`)
      })
      .catch(reportError)

  const onRenameDoc = (d: DocMeta) =>
    dialog
      .prompt({ title: 'Rename document', label: 'Title', defaultValue: d.title, confirmText: 'Rename' })
      .then((title) => (title && title !== d.title ? renameDocument(d.id, title).then(() => refresh()) : undefined))
      .catch(reportError)

  const onDeleteDoc = (d: DocMeta, p: Project) =>
    dialog
      .confirm({
        title: 'Delete document',
        message: `Delete “${d.title}”? This cannot be undone.`,
        confirmText: 'Delete',
        danger: true,
      })
      .then(async (ok) => {
        if (!ok) return
        await removeRecord('documents', d.id)
        await refresh()
        if (p.slug === projectSlug && d.slug === docSlug) navigate('/')
      })
      .catch(reportError)

  // ---- row renderers ----
  const docRow = (d: DocMeta, p: Project, editable: boolean) => {
    const active = p.slug === projectSlug && d.slug === docSlug
    return (
      <div key={d.id} className={`doc-row ${active ? 'active' : ''}`}>
        <Link className="doc-link" to={`/${p.slug}/${d.slug}`} onClick={onCloseDrawer}>
          <FileText size={15} className="row-icon" />
          <span className="row-label">{d.title}</span>
        </Link>
        {editable && (
          <div className="row-actions">
            <button className="icon-btn" title="Rename" onClick={() => void onRenameDoc(d)}>
              <Pencil size={13} />
            </button>
            <button className="icon-btn" title="Delete" onClick={() => void onDeleteDoc(d, p)}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderProjectContents = (p: Project, editable: boolean) => {
    const projectFolders = folders.filter((f) => f.project_id === p.id)
    const rootDocs = documents.filter((d) => d.project_id === p.id && !d.folder_id)
    const empty = projectFolders.length === 0 && rootDocs.length === 0
    return (
      <>
        {projectFolders.map((f) => {
          const isCollapsed = collapsed.has(f.id)
          const folderDocs = documents.filter((d) => d.folder_id === f.id)
          return (
            <div key={f.id} className="folder-block">
              <div className="folder-row">
                <button className="folder-toggle" onClick={() => toggleCollapse(f.id)}>
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <FolderIcon size={15} className="row-icon" />
                  <span className="row-label">{f.name}</span>
                </button>
                {editable && (
                  <div className="row-actions">
                    <button className="icon-btn" title="New document" onClick={() => void onCreateDoc(p, f.id)}>
                      <FilePlus size={13} />
                    </button>
                    <button className="icon-btn" title="Rename" onClick={() => void onRenameFolder(f)}>
                      <Pencil size={13} />
                    </button>
                    <button className="icon-btn" title="Delete" onClick={() => void onDeleteFolder(f)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
              {!isCollapsed && (
                <div className="folder-children">
                  {folderDocs.map((d) => docRow(d, p, editable))}
                  {folderDocs.length === 0 && <div className="tree-empty-sm">empty</div>}
                </div>
              )}
            </div>
          )
        })}
        {rootDocs.map((d) => docRow(d, p, editable))}
        {empty && <div className="tree-empty">No documents yet</div>}
      </>
    )
  }

  return (
    <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        <Link
          to="/"
          className="brand"
          onClick={() => {
            setSelectedProjectId(null)
            onCloseDrawer()
          }}
        >
          Claudia
        </Link>
        <button className="icon-btn" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <nav className="tree">
        {selectedProject ? (
          <>
            <div className="project-head">
              <button className="back-row" onClick={() => setSelectedProjectId(null)}>
                <ChevronLeft size={14} />
                <span>All projects</span>
              </button>
              <div className="row-actions">
                {canEdit(selectedProject) && (
                  <>
                    <button className="icon-btn" title="New folder" onClick={() => void onCreateFolder(selectedProject)}>
                      <FolderPlus size={14} />
                    </button>
                    <button className="icon-btn" title="New document" onClick={() => void onCreateDoc(selectedProject, null)}>
                      <FilePlus size={14} />
                    </button>
                  </>
                )}
                {canManage(selectedProject) && (
                  <>
                    <button className="icon-btn" title="Rename project" onClick={() => void onRenameProject(selectedProject)}>
                      <Pencil size={14} />
                    </button>
                    <button className="icon-btn" title="Delete project" onClick={() => void onDeleteProject(selectedProject)}>
                      <Trash2 size={14} />
                    </button>
                    <button className="icon-btn" title="Share" onClick={() => setSettingsOpen(true)}>
                      <Settings size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="project-current">
              <VisibilityIcon v={visOf(selectedProject)} size={14} />
              <span className="row-label">{selectedProject.name}</span>
            </div>
            {renderProjectContents(selectedProject, canEdit(selectedProject))}
          </>
        ) : (
          <>
            {projects.length === 0 && <div className="tree-empty">No projects yet</div>}
            {projects.map((p) => (
              <div key={p.id} className="project-row">
                <button className="project-open" onClick={() => setSelectedProjectId(p.id)}>
                  <FolderIcon size={15} className="row-icon" />
                  <span className="row-label">{p.name}</span>
                  <span className="vis-mini" title={visOf(p)}>
                    <VisibilityIcon v={visOf(p)} />
                  </span>
                  <ChevronRight size={14} className="project-chevron" />
                </button>
                {canManage(p) && (
                  <div className="row-actions">
                    <button className="icon-btn" title="Rename" onClick={() => void onRenameProject(p)}>
                      <Pencil size={13} />
                    </button>
                    <button className="icon-btn" title="Delete" onClick={() => void onDeleteProject(p)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {user && (
              <button className="add-row" onClick={() => void onCreateProject()}>
                <Plus size={15} />
                <span>New project</span>
              </button>
            )}
          </>
        )}
      </nav>

      <div className="account">
        {user ? (
          <div className="account-info">
            <div className="account-name" title={user.email ?? undefined}>
              {user.name || user.email || 'Account'}
            </div>
            <div className="account-meta">
              <span className={`role-badge role-${role}`}>{role}</span>
              {isAdmin && (
                <Link to="/admin/users" className="admin-link" onClick={onCloseDrawer}>
                  Users
                </Link>
              )}
              <button className="link-btn" onClick={() => void logout()}>
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => setShowLogin(true)}>
            Sign in
          </button>
        )}
      </div>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {settingsOpen && selectedProject && (
        <ProjectSettings
          project={selectedProject}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => void refresh()}
        />
      )}
    </aside>
  )
}
