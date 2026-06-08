// Builds the in-memory virtual filesystem the compiler hands to the engine: every project document
// as a real file at its `<folder.name>/<title>` path (so `\input{chapters/ch1}` resolves — §3.2),
// plus any referenced binary media assets, plus optionally-bundled class/style files (e.g. fithesis).
//
// Pure path logic (documentPath) is separated from the I/O (media download, bundled-file fetch) so the
// path rule stays unit-testable. This file depends only on the app-owned LatexFile type — never on the
// engine — keeping the §3.14 boundary intact.

import { supabase } from '../supabase'
import { extractStoragePaths } from '../storage'
import type { LatexFile } from './compiler'

/** The minimum a document needs to become a virtual file. `content` is the full source (the tree only
 *  caches metadata, so callers fetch full docs via fetchDocument/useDocument first). */
export interface LatexDoc {
  id: string
  title: string
  folder_id: string | null
  content: string
}

/** The minimum a folder needs to resolve a document's directory. */
export interface FolderLite {
  id: string
  name: string
}

const MEDIA_BUCKET = 'media'
// Same-origin location of optionally-bundled TeX class/style files (e.g. fithesis4). A `manifest.json`
// here lists the files to load; absent/empty → none bundled (general LaTeX still compiles). See
// public/tex/fithesis/README.md. Each manifest entry's memfs path mirrors its path under this base.
const BUNDLED_TEX_BASE = '/tex/fithesis'

/**
 * Compute a document's memfs path: `<folder.name>/<title>` for foldered docs, `<title>` at the root.
 * Pure. `folderNameById` maps folder_id → folder.name (a doc whose folder is missing falls back to
 * root, so a stale folder reference can't drop the file from the compile).
 */
export function documentPath(doc: LatexDoc, folderNameById: Map<string, string>): string {
  const folderName = doc.folder_id ? folderNameById.get(doc.folder_id) : undefined
  const title = doc.title.trim()
  return folderName ? `${folderName}/${title}` : title
}

const basename = (p: string): string => p.split('/').pop() || p

/**
 * Assemble the full virtual filesystem for a compile. Returns text files for every document plus any
 * `storage:`-referenced media (downloaded from the private bucket, session-authenticated) and any
 * bundled TeX files. Media/bundle fetch failures are skipped (logged), never fatal — a missing image
 * should degrade the PDF, not abort the build.
 */
export async function buildVirtualFiles(opts: {
  documents: LatexDoc[]
  folders: FolderLite[]
  /** Override the bundled-TeX base (defaults to /tex/fithesis); set '' to skip bundled files. */
  bundledTexBase?: string
}): Promise<LatexFile[]> {
  const { documents, folders } = opts
  const folderNameById = new Map(folders.map((f) => [f.id, f.name]))

  // 1) Every document → a text file at its memfs path.
  const files: LatexFile[] = documents.map((doc) => ({
    path: documentPath(doc, folderNameById),
    content: doc.content,
  }))

  // 2) Referenced media assets → binary files (keyed by basename, since there is no LaTeX upload UX
  //    yet — §3.8/§7; this is the forward-looking seam and a no-op when no `storage:` refs exist).
  const mediaPaths = [...new Set(documents.flatMap((d) => extractStoragePaths(d.content)))]
  const mediaFiles = await Promise.all(
    mediaPaths.map(async (path): Promise<LatexFile | null> => {
      try {
        const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(path)
        if (error || !data) return null
        return { path: basename(path), content: new Uint8Array(await data.arrayBuffer()) }
      } catch {
        return null
      }
    }),
  )
  for (const f of mediaFiles) if (f) files.push(f)

  // 3) Bundled class/style files (e.g. fithesis) listed in a same-origin manifest.
  const base = opts.bundledTexBase ?? BUNDLED_TEX_BASE
  if (base) files.push(...(await fetchBundledTexFiles(base)))

  return files
}

/**
 * Gather a whole LaTeX project into a compile-ready virtual filesystem: fetch every document's full
 * content (the tree caches only metadata) + its folders straight from Supabase, optionally overlay the
 * open editor's unsaved buffer for one doc, build the memfs, and resolve the compile root's memfs path.
 *
 * `override` lets `useLatexCompile` compile the very latest keystrokes before the 800 ms autosave has
 * flushed to the DB. `mainDocId` is `project.main_document_id`; it falls back to the first document so a
 * project whose main was never set still compiles something. Throws only when the project has no files.
 */
export async function buildProjectVirtualFiles(opts: {
  projectId: string
  mainDocId: string | null
  override?: { id: string; content: string } | null
}): Promise<{ files: LatexFile[]; mainPath: string }> {
  const { projectId, mainDocId, override } = opts
  const [docsRes, foldersRes] = await Promise.all([
    supabase.from('documents').select('id,title,folder_id,content').eq('project_id', projectId),
    supabase.from('folders').select('id,name').eq('project_id', projectId),
  ])
  if (docsRes.error) throw new Error(docsRes.error.message)
  let documents = (docsRes.data ?? []) as LatexDoc[]
  if (!documents.length) throw new Error('This project has no files to compile.')
  if (override) {
    documents = documents.map((d) => (d.id === override.id ? { ...d, content: override.content } : d))
  }
  const folders = (foldersRes.data ?? []) as FolderLite[]
  const files = await buildVirtualFiles({ documents, folders })
  const folderNameById = new Map(folders.map((f) => [f.id, f.name]))
  const mainDoc = documents.find((d) => d.id === mainDocId) ?? documents[0]
  return { files, mainPath: documentPath(mainDoc, folderNameById) }
}

/**
 * Fetch the bundled TeX files listed in `${base}/manifest.json` (an array of memfs-relative paths,
 * each served at `${base}/<path>`). Returns [] if the manifest is missing/empty/unfetchable, so the
 * fithesis bundle is purely additive — general LaTeX compiles with none of it present.
 */
export async function fetchBundledTexFiles(base: string): Promise<LatexFile[]> {
  let manifest: string[]
  try {
    const res = await fetch(`${base}/manifest.json`, { cache: 'force-cache' })
    if (!res.ok) return []
    const json: unknown = await res.json()
    manifest = Array.isArray(json) ? json.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }

  const out = await Promise.all(
    manifest.map(async (rel): Promise<LatexFile | null> => {
      try {
        const res = await fetch(`${base}/${rel}`, { cache: 'force-cache' })
        if (!res.ok) return null
        return { path: rel, content: new Uint8Array(await res.arrayBuffer()) }
      } catch {
        return null
      }
    }),
  )
  return out.filter((f): f is LatexFile => f !== null)
}
