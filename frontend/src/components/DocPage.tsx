import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDocument, useTree } from '../hooks/useTree'
import DocView from './DocView'
import Editor from './Editor'
import ModeSwitch from './ModeSwitch'
import type { Mode } from './ModeSwitch'

export default function DocPage() {
  const { projectSlug, docSlug } = useParams()
  const { isEditor } = useAuth()
  const { projects, folders, documents, loading: treeLoading } = useTree()

  const project = projects.find((p) => p.slug === projectSlug)
  const meta = project ? documents.find((d) => d.project === project.id && d.slug === docSlug) : undefined
  const folder = meta?.folder ? folders.find((f) => f.id === meta.folder) : undefined
  const docId = meta?.id

  const { data: docRec, error } = useDocument(docId)
  const [liveContent, setLiveContent] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('view')

  // Reset transient UI when switching documents.
  useEffect(() => {
    setLiveContent(null)
    setMode('view')
  }, [docId])

  if (!project || !meta) {
    if (treeLoading) return <div className="doc-loading">Loading…</div>
    return (
      <div className="empty-state">
        <h1>Not found</h1>
        <p className="muted">This document doesn’t exist.</p>
        <Link className="btn" to="/">
          Go home
        </Link>
      </div>
    )
  }

  if (error) return <div className="form-error">{error.message}</div>
  // Cached docs render instantly; only the very first visit (no cache) shows this.
  if (!docRec) return <div className="doc-loading">Loading…</div>

  const isEdit = isEditor && mode !== 'view'
  const viewContent = liveContent ?? docRec.content

  return (
    <div className="doc-page">
      <header className="doc-header">
        <div className="doc-titles">
          <div className="doc-crumb">
            {project.name}
            {folder ? ` / ${folder.name}` : ''}
          </div>
          <h1 className="doc-title">{docRec.title}</h1>
        </div>
        <div className="doc-actions">{isEditor && <ModeSwitch mode={mode} onChange={setMode} />}</div>
      </header>

      {isEdit ? (
        <Editor key={docRec.id} doc={docRec} showPreview={mode === 'split'} onContentChange={setLiveContent} />
      ) : (
        <div className="doc-body">
          <div className="doc-view">
            <DocView content={viewContent} />
          </div>
        </div>
      )}
    </div>
  )
}
