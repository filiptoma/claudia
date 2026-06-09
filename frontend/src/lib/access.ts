import type { DocumentRec, Folder, MemberRole, Project, ResourceGrant, Role, Visibility } from './types'

// Frontend mirror of the RLS rules — used only to show/hide UI. The database is the real gate.
// Permission tiers (ascending):
//   viewer    → can read
//   commenter → can read + comment + suggest edits
//   editor    → can read + comment + suggest + edit content
//   owner     → everything + manage (settings, delete)
//
// Admin/mod policy change (0013): staff no longer get elevated access on private projects.
// Admin gets owner-level access on PUBLIC projects; mod gets editor-level on PUBLIC projects.

export const isStaffRole = (role: Role): boolean => role === 'mod' || role === 'admin'

/** Can this user view the project? */
export function canViewProject(
  project: Pick<Project, 'owner' | 'is_workspace' | 'is_public'>,
  uid: string | null,
  myMemberRole: MemberRole | undefined,
): boolean {
  if (project.is_workspace) return !!uid && project.owner === uid
  if (project.is_public) return true
  if (uid && project.owner === uid) return true
  return !!myMemberRole // any member role grants view
}

/** Can this user comment/suggest on the project? */
export function canCommentProject(
  project: Pick<Project, 'owner' | 'is_workspace' | 'is_public' | 'public_role'>,
  role: Role,
  uid: string | null,
  myMemberRole: MemberRole | undefined,
): boolean {
  if (project.is_workspace) return !!uid && project.owner === uid
  if (uid && project.owner === uid) return true
  if (project.is_public && isStaffRole(role)) return true // admin/mod on public
  // Public projects can grant a baseline tier to everyone with access.
  if (project.is_public && !!uid && (project.public_role === 'commenter' || project.public_role === 'editor'))
    return true
  return myMemberRole === 'commenter' || myMemberRole === 'editor'
}

/** Can this user edit content (documents, folders) in the project? */
export function canEditProject(
  project: Pick<Project, 'owner' | 'is_workspace' | 'is_public' | 'public_role'>,
  role: Role,
  uid: string | null,
  myMemberRole: MemberRole | undefined,
): boolean {
  if (project.is_workspace) return !!uid && project.owner === uid
  if (uid && project.owner === uid) return true
  if (project.is_public && isStaffRole(role)) return true // admin/mod on public
  if (project.is_public && !!uid && project.public_role === 'editor') return true
  return myMemberRole === 'editor'
}

// ---- per-folder & per-document permission overrides (migrations 0018 + 0020) ----
// Access is capped at three levels: project role → folder cap → document cap. A cap can only RESTRICT,
// never elevate, and the project OWNER is exempt from every cap. These mirror can_edit_folder /
// can_edit_document / can_comment_document in the DB; the DB is the real gate.

type Override = MemberRole | null | undefined
type DocOverride = Pick<DocumentRec, 'access_override' | 'is_private'>
type FolderOverride = Pick<Folder, 'access_override' | 'is_private'>
type ProjectGrant = Pick<Project, 'owner' | 'is_workspace' | 'is_public' | 'public_role'>

const allowsEdit = (o: Override): boolean => o == null || o === 'editor'
const allowsComment = (o: Override): boolean => o == null || o === 'commenter' || o === 'editor'
const isOwner = (project: Pick<Project, 'owner'>, uid: string | null): boolean =>
  !!uid && project.owner === uid

// ---- private resources (migration 0023) ----
// On a PRIVATE folder/document the effective tier comes from the user's resource_grants row (NOT their
// project role or the access_override cap). These mirror can_edit/comment_folder/document in the DB.
type Grant = Pick<ResourceGrant, 'user_id' | 'folder_id' | 'document_id' | 'role'>

const grantAllowsEdit = (g: MemberRole | null): boolean => g === 'editor'
const grantAllowsComment = (g: MemberRole | null): boolean => g === 'commenter' || g === 'editor'

/** The current user's grant role on a private folder, or null. */
export function folderGrantRole(grants: Grant[], folderId: string, uid: string | null): MemberRole | null {
  if (!uid) return null
  return grants.find((g) => g.user_id === uid && g.folder_id === folderId)?.role ?? null
}

/** The current user's effective grant role on a document: its own grant, else (for a doc in a private
 *  folder) the parent folder's grant. null if neither. */
export function documentGrantRole(
  grants: Grant[],
  doc: { id: string; folder_id: string | null },
  uid: string | null,
): MemberRole | null {
  if (!uid) return null
  const direct = grants.find((g) => g.user_id === uid && g.document_id === doc.id)?.role
  if (direct) return direct
  return doc.folder_id ? folderGrantRole(grants, doc.folder_id, uid) : null
}

/** Owner-only, non-workspace, markdown-only: who may set a folder/document permission cap (mirrors the
 *  DB trigger). LaTeX projects have no per-file/per-folder caps (access is project-level only, §3.4), so
 *  this single guard hides every "Permissions" menu entry across the app for them. */
export function canSetPermissions(
  project: Pick<Project, 'owner' | 'is_workspace' | 'type'>,
  uid: string | null,
): boolean {
  return project.type === 'markdown' && !project.is_workspace && isOwner(project, uid)
}

/** Can this user edit THIS folder (rename/delete it, create documents in it)? On a private folder the
 *  grant role decides (pass the user's folder grant); otherwise the project role + cap. */
export function canEditFolder(
  project: ProjectGrant,
  folder: FolderOverride,
  role: Role,
  uid: string | null,
  myMemberRole: MemberRole | undefined,
  grant: MemberRole | null = null,
): boolean {
  if (isOwner(project, uid)) return true // owner is exempt from caps and privacy
  if (folder.is_private) return grantAllowsEdit(grant)
  if (!canEditProject(project, role, uid, myMemberRole)) return false
  return allowsEdit(folder.access_override)
}

/** Can this user edit THIS document's content? On a private document (or a doc inside a private folder)
 *  the grant role decides (pass documentGrantRole); otherwise the project role folds in both caps. */
export function canEditDocument(
  project: ProjectGrant,
  doc: DocOverride,
  folder: FolderOverride | null | undefined,
  role: Role,
  uid: string | null,
  myMemberRole: MemberRole | undefined,
  grant: MemberRole | null = null,
): boolean {
  if (isOwner(project, uid)) return true
  if (doc.is_private || folder?.is_private) return grantAllowsEdit(grant)
  if (!canEditProject(project, role, uid, myMemberRole)) return false
  return allowsEdit(doc.access_override) && allowsEdit(folder?.access_override)
}

/** Can this user comment/suggest on THIS document? On a private document the grant role decides. */
export function canCommentDocument(
  project: ProjectGrant,
  doc: DocOverride,
  folder: FolderOverride | null | undefined,
  role: Role,
  uid: string | null,
  myMemberRole: MemberRole | undefined,
  grant: MemberRole | null = null,
): boolean {
  if (isOwner(project, uid)) return true
  if (doc.is_private || folder?.is_private) return grantAllowsComment(grant)
  if (!canCommentProject(project, role, uid, myMemberRole)) return false
  return allowsComment(doc.access_override) && allowsComment(folder?.access_override)
}

/** Can this user manage the project (rename, settings, delete, membership)? */
export function canManageProject(
  project: Pick<Project, 'owner' | 'is_workspace' | 'is_public'>,
  role: Role,
  uid: string | null,
): boolean {
  if (project.is_workspace) return !!uid && project.owner === uid
  if (uid && project.owner === uid) return true
  if (project.is_public && role === 'admin') return true // admin only (not mod) on public
  return false
}

export function projectVisibility(project: Pick<Project, 'is_public'>, memberCount: number): Visibility {
  if (project.is_public) return 'public'
  return memberCount > 0 ? 'shared' : 'private'
}

export const isWorkspace = (project: Pick<Project, 'is_workspace'>): boolean => project.is_workspace

// "Configure" = manage actions. Workspace is exempt.
export function canConfigureProject(
  project: Pick<Project, 'owner' | 'is_workspace' | 'is_public'>,
  role: Role,
  uid: string | null,
): boolean {
  return !project.is_workspace && canManageProject(project, role, uid)
}
