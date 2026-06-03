import type { MemberRole, Project, Role, Visibility } from './types'

// Frontend mirror of the RLS rules — used only to show/hide UI. The database is the real gate.

export const isStaffRole = (role: Role): boolean => role === 'mod' || role === 'admin'

export function canEditProject(
  project: Pick<Project, 'owner' | 'is_workspace'>,
  role: Role,
  uid: string | null,
  myMemberRole: MemberRole | undefined,
): boolean {
  // A workspace is private to its owner — staff get no special access (mirrors RLS).
  if (project.is_workspace) return !!uid && project.owner === uid
  if (isStaffRole(role)) return true
  if (uid && project.owner === uid) return true
  return myMemberRole === 'editor'
}

export function canManageProject(
  project: Pick<Project, 'owner' | 'is_workspace'>,
  role: Role,
  uid: string | null,
): boolean {
  if (project.is_workspace) return !!uid && project.owner === uid
  if (isStaffRole(role)) return true
  return !!uid && project.owner === uid
}

export function projectVisibility(project: Pick<Project, 'is_public'>, memberCount: number): Visibility {
  if (project.is_public) return 'public'
  return memberCount > 0 ? 'shared' : 'private'
}

// The workspace is a special project that can never be renamed, deleted, shared, or made public.
export const isWorkspace = (project: Pick<Project, 'is_workspace'>): boolean => project.is_workspace

// "Configure" = the manage actions (rename / delete / share / settings). The workspace is exempt.
export function canConfigureProject(
  project: Pick<Project, 'owner' | 'is_workspace'>,
  role: Role,
  uid: string | null,
): boolean {
  return !project.is_workspace && canManageProject(project, role, uid)
}
