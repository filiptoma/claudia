import { customAlphabet } from 'nanoid'
import { supabase } from './supabase'
import { nextOrder } from './order'
import { slugify } from './slug'
import type {
  Anchor,
  CommentMessage,
  CommentThread,
  DocumentRec,
  Folder,
  InviteLink,
  MemberInfo,
  MemberRole,
  MentionableUser,
  Project,
  ProjectType,
  RedeemResult,
  ResourceGrantInfo,
  SuggestionMessage,
  SuggestionThread,
} from './types'

// A minimal, known-good LaTeX document seeded into every new LaTeX project's main.tex, so the user
// sees a compilable file on first open rather than a blank page.
const STARTER_MAIN_TEX = `\\documentclass{article}
\\begin{document}
Hello, \\LaTeX!
\\end{document}
`

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

export async function createProject(
  name: string,
  ownerId: string,
  type: ProjectType = 'markdown',
): Promise<Project> {
  const sort_order = await nextOrder('projects')
  // New projects are private (is_public=false, no members) and owned by the creator.
  return insertWithNanoidSlug<Project>(
    'projects',
    { name, owner: ownerId, is_public: false, type, sort_order },
    name,
  )
}

// The compile-root document of a new LaTeX project, seeded with a minimal compilable doc. The caller
// (newProject) wires it as the project's main_document_id via setMainDocument.
export async function createMainTexDocument(projectId: string): Promise<DocumentRec> {
  const sort_order = await nextOrder('documents', { project_id: projectId, folder_id: null })
  return insertDocument({
    title: 'main.tex',
    project_id: projectId,
    folder_id: null,
    content: STARTER_MAIN_TEX,
    sort_order,
  })
}

// Point a LaTeX project at its compile root (the main .tex). Also used by a future "Set as main file".
export async function setMainDocument(projectId: string, documentId: string): Promise<void> {
  await update('projects', projectId, { main_document_id: documentId })
}

export async function createFolder(projectId: string, name: string): Promise<Folder> {
  const sort_order = await nextOrder('folders', { project_id: projectId })
  return insertWithNanoidSlug<Folder>('folders', { name, project_id: projectId, sort_order }, name)
}

export async function createDocument(
  projectId: string,
  folderId: string | null,
  title: string,
  projectType: ProjectType = 'markdown',
): Promise<DocumentRec> {
  const sort_order = await nextOrder('documents', { project_id: projectId, folder_id: folderId })
  // Markdown docs prefill an H1 of the title as a one-time convenience (the heading and the title are
  // NOT kept in sync afterwards). LaTeX files are filenames, not headings, so they seed empty — the
  // author writes the preamble/body (or \input-s from main.tex). (Quick notes stay empty too.)
  const content = projectType === 'latex' ? '' : `# ${title.trim()}\n`
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

// The baseline role everyone with access to a PUBLIC project gets (viewer | commenter | editor).
export async function setProjectPublicRole(projectId: string, role: MemberRole): Promise<void> {
  await update('projects', projectId, { public_role: role })
}

// Set (or clear, with null) a permission cap on a single document or folder. null = inherit; a folder
// cap also restricts every document inside it. Owner-only — RLS + the protect_*_override triggers
// enforce it server-side.
export async function setDocumentAccessOverride(
  documentId: string,
  override: MemberRole | null,
): Promise<void> {
  await update('documents', documentId, { access_override: override })
}

export async function setFolderAccessOverride(
  folderId: string,
  override: MemberRole | null,
): Promise<void> {
  await update('folders', folderId, { access_override: override })
}

// ---- private resources & invite links (migrations 0023 + 0024) ----
// Marking a folder/document private hides it from everyone except the owner and explicit grantees.
// Owner-only — the protect_*_privacy triggers enforce it server-side.

export async function setFolderPrivate(folderId: string, isPrivate: boolean): Promise<void> {
  await update('folders', folderId, { is_private: isPrivate })
}

export async function setDocumentPrivate(documentId: string, isPrivate: boolean): Promise<void> {
  await update('documents', documentId, { is_private: isPrivate })
}

// The grantees of a private folder/document, resolved with profile info (owner-only RPC — the profiles
// table itself isn't readable). Pass exactly one of folderId / documentId.
export async function listResourceGrants(target: {
  folderId?: string
  documentId?: string
}): Promise<ResourceGrantInfo[]> {
  const { data, error } = await supabase.rpc('list_resource_grants', {
    p_folder: target.folderId ?? null,
    p_document: target.documentId ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as ResourceGrantInfo[] | null) ?? []
}

// Directly grant/upsert a known user onto a private resource (owner-only via RLS). Used by the
// member-pick path on PRIVATE projects; for PUBLIC projects, grants are created by redeeming a link.
export async function setResourceGrant(
  target: { projectId: string; folderId?: string; documentId?: string },
  userId: string,
  role: MemberRole,
): Promise<void> {
  const { error } = await supabase.from('resource_grants').upsert(
    {
      project_id: target.projectId,
      folder_id: target.folderId ?? null,
      document_id: target.documentId ?? null,
      user_id: userId,
      role,
    },
    { onConflict: target.folderId ? 'folder_id,user_id' : 'document_id,user_id' },
  )
  if (error) throw new Error(error.message)
}

export async function removeResourceGrant(
  target: { folderId?: string; documentId?: string },
  userId: string,
): Promise<void> {
  let q = supabase.from('resource_grants').delete().eq('user_id', userId)
  q = target.folderId ? q.eq('folder_id', target.folderId) : q.eq('document_id', target.documentId as string)
  const { error } = await q
  if (error) throw new Error(error.message)
}

// Create a share link (manager-only RPC). The raw token is returned ONCE here; build the URL from it.
// folderId/documentId both omitted = a whole-project link (for private projects, incl. LaTeX).
export async function createInviteLink(args: {
  projectId: string
  folderId?: string | null
  documentId?: string | null
  role: MemberRole
  expiresAt?: string | null
  maxUses?: number | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_invite_link', {
    p_project: args.projectId,
    p_folder: args.folderId ?? null,
    p_document: args.documentId ?? null,
    p_role: args.role,
    p_expires_at: args.expiresAt ?? null,
    p_max_uses: args.maxUses ?? null,
  })
  if (error) throw new Error(error.message)
  return data as string
}

// List a project's invite links (manager-only via RLS). Pass a resource filter to scope to one folder/doc.
export async function listInviteLinks(
  projectId: string,
  target?: { folderId?: string | null; documentId?: string | null },
): Promise<InviteLink[]> {
  let q = supabase.from('invite_links').select('*').eq('project_id', projectId).order('created_at')
  if (target?.folderId) q = q.eq('folder_id', target.folderId)
  else if (target?.documentId) q = q.eq('document_id', target.documentId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data as InviteLink[] | null) ?? []
}

export async function revokeInviteLink(id: string): Promise<void> {
  const { error } = await supabase.from('invite_links').update({ revoked: true }).eq('id', id)
  if (error) throw new Error(error.message)
}

// Redeem a share link as the signed-in user. Returns the target's slugs so the caller can redirect to
// the resource it just unlocked; throws a human-readable message on invalid/revoked/expired/used links.
export async function redeemInvite(token: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc('redeem_invite', { p_token: token })
  if (error) throw new Error(error.message)
  const row = (data as RedeemResult[] | null)?.[0]
  if (!row) throw new Error('This invite link is invalid')
  return row
}

// Resolve a typed email to a mention target (members always; anyone on a public project). Returns
// null if no matching, mentionable profile exists.
export async function findMentionableByEmail(
  projectId: string,
  email: string,
): Promise<MentionableUser | null> {
  const { data, error } = await supabase.rpc('find_mentionable_by_email', {
    p_project: projectId,
    p_email: email,
  })
  if (error) throw new Error(error.message)
  return ((data as MentionableUser[] | null) ?? [])[0] ?? null
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

// ---- annotations: inline comments ----
// Reads go through SECURITY DEFINER RPCs (the profiles table is private, so we can't join author
// name/avatar client-side). Writes are single-row table ops gated by RLS, except thread creation
// which is an atomic RPC (thread + first message).

export async function listMentionableUsers(projectId: string): Promise<MentionableUser[]> {
  const { data, error } = await supabase.rpc('list_mentionable_users', { p_project: projectId })
  if (error) throw new Error(error.message)
  return (data as MentionableUser[] | null) ?? []
}

export async function listDocumentCommentThreads(documentId: string): Promise<CommentThread[]> {
  const { data, error } = await supabase.rpc('list_document_comment_threads', { p_document: documentId })
  if (error) throw new Error(error.message)
  return (data as CommentThread[] | null) ?? []
}

export async function listDocumentComments(documentId: string): Promise<CommentMessage[]> {
  const { data, error } = await supabase.rpc('list_document_comments', { p_document: documentId })
  if (error) throw new Error(error.message)
  return (data as CommentMessage[] | null) ?? []
}

export async function createCommentThread(args: {
  documentId: string
  anchor: Anchor
  sourceStart: number
  sourceEnd: number
  body: string
  mentions: string[]
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_comment_thread', {
    p_document: args.documentId,
    p_anchor: args.anchor,
    p_source_start: args.sourceStart,
    p_source_end: args.sourceEnd,
    p_body: args.body,
    p_mentions: args.mentions,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function addComment(
  threadId: string,
  author: string,
  body: string,
  mentions: string[],
): Promise<void> {
  const { error } = await supabase
    .from('comments')
    .insert({ thread_id: threadId, author, body, mentions })
  if (error) throw new Error(error.message)
}

// Edit a message body (comment or reply). RLS allows the author only (c_update / sc_update).
export async function editComment(commentId: string, body: string, mentions: string[]): Promise<void> {
  const { error } = await supabase.from('comments').update({ body, mentions }).eq('id', commentId)
  if (error) throw new Error(error.message)
}

export async function setThreadResolved(
  threadId: string,
  resolved: boolean,
  resolvedBy: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('comment_threads')
    .update({
      resolved,
      resolved_by: resolved ? resolvedBy : null,
      resolved_at: resolved ? new Date().toISOString() : null,
    })
    .eq('id', threadId)
  if (error) throw new Error(error.message)
}

export async function deleteCommentThread(threadId: string): Promise<void> {
  const { error } = await supabase.from('comment_threads').delete().eq('id', threadId)
  if (error) throw new Error(error.message)
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.from('comments').delete().eq('id', commentId)
  if (error) throw new Error(error.message)
}

// ---- annotations: suggested edits ----

export async function listDocumentSuggestions(documentId: string): Promise<SuggestionThread[]> {
  const { data, error } = await supabase.rpc('list_document_suggestions', { p_document: documentId })
  if (error) throw new Error(error.message)
  return (data as SuggestionThread[] | null) ?? []
}

export async function listDocumentSuggestionComments(documentId: string): Promise<SuggestionMessage[]> {
  const { data, error } = await supabase.rpc('list_document_suggestion_comments', { p_document: documentId })
  if (error) throw new Error(error.message)
  return (data as SuggestionMessage[] | null) ?? []
}

export async function createSuggestion(args: {
  documentId: string
  anchor: Anchor
  sourceStart: number
  sourceEnd: number
  originalMd: string
  suggestedMd: string
  note: string
  mentions: string[]
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_suggestion', {
    p_document: args.documentId,
    p_anchor: args.anchor,
    p_source_start: args.sourceStart,
    p_source_end: args.sourceEnd,
    p_original_md: args.originalMd,
    p_suggested_md: args.suggestedMd,
    p_note: args.note,
    p_mentions: args.mentions,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function addSuggestionComment(
  suggestionId: string,
  author: string,
  body: string,
  mentions: string[],
): Promise<void> {
  const { error } = await supabase
    .from('suggestion_comments')
    .insert({ suggestion_id: suggestionId, author, body, mentions })
  if (error) throw new Error(error.message)
}

// Approve a suggestion: applies it to documents.content and marks it accepted (atomic, stale-safe).
export async function approveSuggestion(suggestionId: string): Promise<void> {
  const { error } = await supabase.rpc('apply_suggestion', { p_suggestion: suggestionId })
  if (error) throw new Error(error.message)
}

// Reject a suggestion (editor/owner): marks it rejected — the row is kept until deleted as cleanup.
export async function rejectSuggestion(suggestionId: string): Promise<void> {
  const { error } = await supabase.rpc('reject_suggestion', { p_suggestion: suggestionId })
  if (error) throw new Error(error.message)
}

// Withdraw a still-pending suggestion (its author): removes the row entirely; replies cascade.
export async function withdrawSuggestion(suggestionId: string): Promise<void> {
  const { error } = await supabase.from('suggestion_threads').delete().eq('id', suggestionId)
  if (error) throw new Error(error.message)
}

// Permanently delete a resolved (accepted/rejected) suggestion — editor/owner cleanup.
export async function deleteSuggestion(suggestionId: string): Promise<void> {
  const { error } = await supabase.from('suggestion_threads').delete().eq('id', suggestionId)
  if (error) throw new Error(error.message)
}

// Edit a still-pending suggestion's replacement text (its author only; RLS st_update).
export async function editSuggestion(suggestionId: string, suggestedMd: string): Promise<void> {
  const { error } = await supabase
    .from('suggestion_threads')
    .update({ suggested_md: suggestedMd })
    .eq('id', suggestionId)
  if (error) throw new Error(error.message)
}

export async function deleteSuggestionComment(commentId: string): Promise<void> {
  const { error } = await supabase.from('suggestion_comments').delete().eq('id', commentId)
  if (error) throw new Error(error.message)
}
