import { supabase } from './supabase'
import { nextOrder } from './order'
import { slugify } from './slug'
import type { DocumentRec, Folder, MemberInfo, MemberRole, Project } from './types'

type Table = 'projects' | 'folders' | 'documents'

// Insert, retrying with -2/-3/… on a unique-slug conflict. Needed because RLS can hide a
// colliding project slug from the client, so we can't reliably pre-check uniqueness.
async function insertUniqueSlug<T>(table: Table, fields: Record<string, unknown>, slugBase: string): Promise<T> {
  const root = slugify(slugBase)
  for (let i = 0; ; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`
    const { data, error } = await supabase.from(table).insert({ ...fields, slug }).select().single()
    if (!error) return data as T
    if (error.code === '23505') continue // unique_violation -> bump slug
    throw new Error(error.message)
  }
}

export async function createProject(name: string, ownerId: string): Promise<Project> {
  const sort_order = await nextOrder('projects')
  // New projects are private (is_public=false, no members) and owned by the creator.
  return insertUniqueSlug<Project>('projects', { name, owner: ownerId, is_public: false, sort_order }, name)
}

export async function createFolder(projectId: string, name: string): Promise<Folder> {
  const sort_order = await nextOrder('folders', { project_id: projectId })
  return insertUniqueSlug<Folder>('folders', { name, project_id: projectId, sort_order }, name)
}

export async function createDocument(
  projectId: string,
  folderId: string | null,
  title: string,
): Promise<DocumentRec> {
  const sort_order = await nextOrder('documents', { project_id: projectId, folder_id: folderId })
  return insertUniqueSlug<DocumentRec>(
    'documents',
    { title, project_id: projectId, folder_id: folderId, content: '', sort_order },
    title,
  )
}

async function update(table: Table, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}
export const renameProject = (id: string, name: string) => update('projects', id, { name })
export const renameFolder = (id: string, name: string) => update('folders', id, { name })
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
