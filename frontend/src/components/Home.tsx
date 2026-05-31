import { useNavigate } from 'react-router-dom'
import { ArrowRight, FolderOpen, Plus } from 'lucide-react'
import { useTree } from '../hooks/useTree'
import { useAuth } from '../context/AuthContext'
import { useDialog } from '../context/DialogContext'
import { createDocument, createProject } from '../lib/crud'
import type { Project } from '../lib/types'

export default function Home() {
  const { projects, documents, loading, refresh } = useTree()
  const { isEditor } = useAuth()
  const dialog = useDialog()
  const navigate = useNavigate()

  const openProject = async (p: Project) => {
    const docs = documents.filter((d) => d.project === p.id)
    if (docs.length > 0) {
      navigate(`/${p.slug}/${docs[0].slug}`)
      return
    }
    if (!isEditor) return
    const title =
      (await dialog.prompt({ title: 'New document', label: 'Document title', confirmText: 'Create' })) || null
    if (!title) return
    const doc = await createDocument(p.id, null, title)
    await refresh()
    navigate(`/${p.slug}/${doc.slug}`)
  }

  const onCreateFirst = async () => {
    const name = await dialog.prompt({
      title: 'New project',
      label: 'Project name',
      placeholder: 'e.g. Algorithms',
      confirmText: 'Create',
    })
    if (!name) return
    const project = await createProject(name)
    const title =
      (await dialog.prompt({
        title: 'First document',
        label: 'Document title',
        defaultValue: 'Welcome',
        confirmText: 'Create',
      })) || 'Welcome'
    const doc = await createDocument(project.id, null, title)
    await refresh()
    navigate(`/${project.slug}/${doc.slug}`)
  }

  if (loading) return <div className="doc-loading">Loading…</div>

  return (
    <div className="home">
      <div className="home-hero">
        <h1>Claudia</h1>
        <p className="muted">A clean, shared markdown knowledge base.</p>
      </div>

      {projects.length === 0 ? (
        <div className="home-empty">
          <p className="muted">
            {isEditor ? 'No projects yet — create your first to get started.' : 'There is no content here yet.'}
          </p>
          {isEditor && (
            <button className="btn btn-primary" onClick={() => void onCreateFirst()}>
              <Plus size={16} /> Create your first project
            </button>
          )}
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => {
            const count = documents.filter((d) => d.project === p.id).length
            return (
              <button key={p.id} className="project-card" onClick={() => void openProject(p)}>
                <FolderOpen size={20} className="project-card-icon" />
                <div className="project-card-body">
                  <div className="project-card-name">{p.name}</div>
                  <div className="project-card-meta">
                    {count} {count === 1 ? 'document' : 'documents'}
                  </div>
                </div>
                <ArrowRight size={16} className="project-card-arrow" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
