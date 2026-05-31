import { pb } from './pb'
import { nextOrder } from './order'
import { uniqueSlug } from './slug'
import type { DocumentRec, Folder, Project, Visibility } from './types'

export async function createProject(name: string): Promise<Project> {
  const slug = await uniqueSlug('projects', name)
  const order = await nextOrder('projects')
  // New projects are private by default — only admins can see them until shared/published.
  return pb.collection('projects').create<Project>({ name, slug, order, visibility: 'private', sharedUsers: [] })
}

export async function setProjectAccess(
  id: string,
  visibility: Visibility,
  sharedUsers: string[],
): Promise<void> {
  await pb.collection('projects').update(id, {
    visibility,
    sharedUsers: visibility === 'shared' ? sharedUsers : [],
  })
}

export async function createFolder(projectId: string, name: string): Promise<Folder> {
  const projFilter = pb.filter('project = {:p}', { p: projectId })
  const slug = await uniqueSlug('folders', name, projFilter)
  const order = await nextOrder('folders', projFilter)
  return pb.collection('folders').create<Folder>({ name, slug, project: projectId, order })
}

export async function createDocument(
  projectId: string,
  folderId: string | null,
  title: string,
): Promise<DocumentRec> {
  // Slug is unique per (project, slug) regardless of folder, so scope the slug by project only.
  const projFilter = pb.filter('project = {:p}', { p: projectId })
  const slug = await uniqueSlug('documents', title, projFilter)
  // Order is scoped to siblings (same folder, or project root).
  const siblingFilter = folderId
    ? pb.filter('project = {:p} && folder = {:f}', { p: projectId, f: folderId })
    : pb.filter('project = {:p} && folder = ""', { p: projectId })
  const order = await nextOrder('documents', siblingFilter)
  return pb.collection('documents').create<DocumentRec>({
    title,
    slug,
    project: projectId,
    folder: folderId ?? '',
    content: '',
    order,
  })
}

// Rename keeps the slug stable so existing URLs don't break.
export async function renameProject(id: string, name: string): Promise<void> {
  await pb.collection('projects').update(id, { name })
}
export async function renameFolder(id: string, name: string): Promise<void> {
  await pb.collection('folders').update(id, { name })
}
export async function renameDocument(id: string, title: string): Promise<void> {
  await pb.collection('documents').update(id, { title })
}

export async function removeRecord(collection: string, id: string): Promise<void> {
  await pb.collection(collection).delete(id)
}
