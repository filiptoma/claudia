// Centralized URL builders so navigation/links stay consistent across the app. The URL mirrors the
// project tree: project → (folder) → document.
//
//   /                                   → dashboard (Home)
//   /profile                            → account / profile
//   /admin                              → admin/mod dashboard
//   /admin/users                        → user list (admin)
//   /admin/projects                     → all-projects list (staff)
//   /:projectSlug                       → project root (folders + docs)
//   /:projectSlug/settings              → project settings
//   /:projectSlug/:folderSlug           → a folder's listing
//   /:projectSlug/:docSlug              → a root-level document
//   /:projectSlug/:folderSlug/:docSlug  → a document inside a folder
export const projectPath = (projectSlug: string) => `/${projectSlug}`

export const folderPath = (projectSlug: string, folderSlug: string) =>
  `/${projectSlug}/${encodeURIComponent(folderSlug)}`

export const docPath = (projectSlug: string, folderSlug: string | null, docSlug: string) =>
  folderSlug
    ? `/${projectSlug}/${encodeURIComponent(folderSlug)}/${encodeURIComponent(docSlug)}`
    : `/${projectSlug}/${encodeURIComponent(docSlug)}`

export const projectSettingsPath = (projectSlug: string) => `/${projectSlug}/settings`

// Quick notes live inside the user's workspace (its slug is normally "my"):
//   /:ws/notes        → all of my quick notes
//   /:ws/notes/:id    → a single quick note (id is the note's nanoid slug)
export const notesPath = (workspaceSlug: string) => `/${workspaceSlug}/notes`
export const notePath = (workspaceSlug: string, slug: string) =>
  `/${workspaceSlug}/notes/${encodeURIComponent(slug)}`
// Opens a quick note straight into split (edit + preview) mode — used right after creating one.
export const noteSplitPath = (workspaceSlug: string, slug: string) =>
  `${notePath(workspaceSlug, slug)}?mode=split`

// Resolve a document's full path from the tree (its folder, if any, supplies the middle segment).
// Structural params keep this free of import cycles with the tree hook.
export function docPathFromTree(
  projectSlug: string,
  doc: { slug: string; folder_id: string | null },
  folders: { id: string; slug: string }[],
): string {
  const folder = doc.folder_id ? folders.find((f) => f.id === doc.folder_id) : undefined
  return docPath(projectSlug, folder?.slug ?? null, doc.slug)
}

export const publicProjectsPath = (params?: { owner?: string; search?: string }) => {
  if (!params) return '/explore'
  const q = new URLSearchParams()
  if (params.owner) q.set('owner', params.owner)
  if (params.search) q.set('search', params.search)
  const qs = q.toString()
  return qs ? `/explore?${qs}` : '/explore'
}

export const userProfilePath = (userId: string) => `/users/${userId}`

// Path that opens a document straight into split (edit + preview) mode — used right after creating a
// document or quick note so the author lands in the editor, not the read-only view.
export const docSplitPath = (
  projectSlug: string,
  doc: { slug: string; folder_id: string | null },
  folders: { id: string; slug: string }[],
) => `${docPathFromTree(projectSlug, doc, folders)}?mode=split`
