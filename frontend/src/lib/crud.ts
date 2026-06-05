import { customAlphabet } from 'nanoid'
import { supabase } from './supabase'
import { nextOrder } from './order'
import { slugify } from './slug'
import type { DocumentRec, Folder, MemberInfo, MemberRole, Project } from './types'

type Table = 'projects' | 'folders' | 'documents'

// 4-char url-safe id suffixed onto project AND folder slugs ("exam-3kf9"). It keeps the URL stable
// and collision-free while the readable part follows the name — so renaming re-slugs the name part
// but never the id, and reserved words like "settings"/"notes" can never clash. (Workspace: "my".)
const shortId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 4)

// Documents are addressed by a short, readable nanoid (e.g. "/proj/k3f9b1qa"), NOT a title-derived
// slug — so renaming a document never leaves the URL out of sync with its title (which would be
// confusing). Long enough to never collide, short enough to stay legible (unlike a uuid).
const documentSlug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8)

// Insert a project/folder as "<slugified-name>-<nanoid>", regenerating the nanoid on the
// (vanishingly rare) unique conflict. RLS can hide a colliding slug, so we can't pre-check it.
async function insertWithNanoidSlug<T>(
  table: 'projects' | 'folders',
  fields: Record<string, unknown>,
  name: string,
): Promise<T> {
  const base = slugify(name)
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .insert({ ...fields, slug: `${base}-${shortId()}` })
      .select()
      .single()
    if (!error) return data as T
    if (error.code === '23505') continue // unique_violation -> new nanoid
    throw new Error(error.message)
  }
}

// Re-slug a project/folder from a new name while preserving its existing nanoid suffix, so the URL
// reflects the rename but the id (and therefore links to it) stays stable.
function reslugKeepingNanoid(currentSlug: string, name: string): string {
  const parts = currentSlug.split('-')
  const nano = parts.length > 1 ? parts[parts.length - 1] : shortId()
  return `${slugify(name)}-${nano}`
}

// Insert a document, retrying with a fresh nanoid slug on the (vanishingly rare) unique conflict.
async function insertDocument(fields: Record<string, unknown>): Promise<DocumentRec> {
  for (;;) {
    const { data, error } = await supabase
      .from('documents')
      .insert({ ...fields, slug: documentSlug() })
      .select()
      .single()
    if (!error) return data as DocumentRec
    if (error.code === '23505') continue // unique_violation -> new nanoid
    throw new Error(error.message)
  }
}

export async function createProject(name: string, ownerId: string): Promise<Project> {
  const sort_order = await nextOrder('projects')
  // New projects are private (is_public=false, no members) and owned by the creator.
  return insertWithNanoidSlug<Project>('projects', { name, owner: ownerId, is_public: false, sort_order }, name)
}

export async function createFolder(projectId: string, name: string): Promise<Folder> {
  const sort_order = await nextOrder('folders', { project_id: projectId })
  return insertWithNanoidSlug<Folder>('folders', { name, project_id: projectId, sort_order }, name)
}

export async function createDocument(
  projectId: string,
  folderId: string | null,
  title: string,
): Promise<DocumentRec> {
  const sort_order = await nextOrder('documents', { project_id: projectId, folder_id: folderId })
  // Prefill the first line with an H1 of the title as a convenience. This is a one-time seed — the
  // heading and the document title are NOT kept in sync afterwards. (Quick notes use createQuickNote
  // and stay empty.)
  const content = `# ${title.trim()}\n`
  return insertDocument({ title, project_id: projectId, folder_id: folderId, content, sort_order })
}

// A quick note is a titleless root document flagged is_quick_note, created with one click in the
// user's workspace. Like every document its slug is a nanoid (see insertDocument).
export async function createQuickNote(workspaceId: string): Promise<DocumentRec> {
  const sort_order = await nextOrder('documents', { project_id: workspaceId, folder_id: null })
  return insertDocument({
    title: '',
    project_id: workspaceId,
    folder_id: null,
    content: '',
    is_quick_note: true,
    sort_order,
  })
}

async function update(table: Table, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

// Renaming a project re-slugs it from the new name but KEEPS its 4-char nanoid suffix (so the URL
// reflects the name yet never collides). The workspace's slug ("my") is fixed and never changes.
// Returns the resulting slug so the caller can keep the URL in sync.
export async function renameProject(
  project: Pick<Project, 'id' | 'slug' | 'is_workspace'>,
  name: string,
): Promise<string> {
  const patch: Record<string, unknown> = { name }
  // The workspace's slug ("my") is fixed; every other project re-slugs but keeps its nanoid.
  const newSlug = project.is_workspace ? project.slug : reslugKeepingNanoid(project.slug, name)
  if (!project.is_workspace) patch.slug = newSlug
  const { error } = await supabase.from('projects').update(patch).eq('id', project.id)
  if (error) throw new Error(error.message)
  return newSlug
}

// Renaming a folder re-slugs it from the new name but keeps its nanoid (same scheme as projects).
// Returns the resulting slug so the caller can keep the URL in sync.
export async function renameFolder(folder: Pick<Folder, 'id' | 'slug'>, name: string): Promise<string> {
  const newSlug = reslugKeepingNanoid(folder.slug, name)
  const { error } = await supabase.from('folders').update({ name, slug: newSlug }).eq('id', folder.id)
  if (error) throw new Error(error.message)
  return newSlug
}

export const renameDocument = (id: string, title: string) => update('documents', id, { title })

export async function removeRecord(table: Table, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ---- sharing ----
export async function setProjectPublic(projectId: string, isPublic: boolean): Promise<void> {
  await update('projects', projectId, { is_public: isPublic })
}

// Resolve an email to a profile via a SECURITY DEFINER RPC (the profiles table itself is not
// readable by non-admins), so an owner can invite by email like Google Docs.
export async function findUserByEmail(email: string): Promise<{ id: string; name: string | null; email: string | null } | null> {
  const { data, error } = await supabase.rpc('find_profile_by_email', { p_email: email })
  if (error) throw new Error(error.message)
  const row = (data as { id: string; name: string | null; email: string | null }[] | null)?.[0]
  return row ?? null
}

export async function listProjectMembers(projectId: string): Promise<MemberInfo[]> {
  const { data, error } = await supabase.rpc('list_project_members', { p_project: projectId })
  if (error) throw new Error(error.message)
  return (data as MemberInfo[] | null) ?? []
}

export async function addMember(projectId: string, userId: string, role: MemberRole): Promise<void> {
  const { error } = await supabase
    .from('project_members')
    .upsert({ project_id: projectId, user_id: userId, role }, { onConflict: 'project_id,user_id' })
  if (error) throw new Error(error.message)
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function getProjectOwner(
  projectId: string,
): Promise<{ id: string; name: string | null; email: string | null; avatar_url: string | null } | null> {
  const { data, error } = await supabase.rpc('get_project_owner', { p_project: projectId })
  if (error) throw new Error(error.message)
  return (
    (data as { id: string; name: string | null; email: string | null; avatar_url: string | null }[] | null)?.[0] ?? null
  )
}

export async function submitFeedback(payload: {
  type: 'bug' | 'request'
  title: string
  description: string
  email: string | null
  userId: string | null
}): Promise<void> {
  const { error } = await supabase.from('feedback').insert({
    type: payload.type,
    title: payload.title,
    description: payload.description,
    email: payload.email || null,
    user_id: payload.userId,
  })
  if (error) throw new Error(error.message)
}
