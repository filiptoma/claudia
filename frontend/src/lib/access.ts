import type { MemberRole, Project, Role, Visibility } from './types'

// Frontend mirror of the RLS rules — used only to show/hide UI. The database is the real gate.

export const isStaffRole = (role: Role): boolean => role === 'mod' || role === 'admin'

export function canEditProject(
  project: Pick<Project, 'owner'>,
  role: Role,
  uid: string | null,
  myMemberRole: MemberRole | undefined,
): boolean {
  if (isStaffRole(role)) return true
  if (uid && project.owner === uid) return true
  return myMemberRole === 'editor'
}

export function canManageProject(
  project: Pick<Project, 'owner'>,
  role: Role,
  uid: string | null,
): boolean {
  if (isStaffRole(role)) return true
  return !!uid && project.owner === uid
}

export function projectVisibility(project: Pick<Project, 'is_public'>, memberCount: number): Visibility {
  if (project.is_public) return 'public'
  return memberCount > 0 ? 'shared' : 'private'
}
