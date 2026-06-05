export type Role = 'basic' | 'mod' | 'admin'
export type MemberRole = 'viewer' | 'editor'
export type Visibility = 'private' | 'shared' | 'public'

export interface Profile {
  id: string
  email: string | null
  name: string | null
  role: Role
  avatar_url: string | null
  created_at: string
}

export interface PublicProject {
  id: string
  name: string
  slug: string
  owner: string | null
  owner_name: string | null
  owner_avatar_url: string | null
  created_at: string
  updated_at: string
  document_count: number
}

export interface Feedback {
  id: string
  type: 'bug' | 'request'
  title: string
  description: string
  email: string | null
  user_id: string | null
  created_at: string
}

export interface PublicProfileSummary {
  id: string
  name: string | null
  avatar_url: string | null
}

export interface Project {
  id: string
  name: string
  slug: string
  owner: string | null
  is_public: boolean
  is_workspace: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ProjectMember {
  project_id: string
  user_id: string
  role: MemberRole
  created_at: string
}

export interface Folder {
  id: string
  name: string
  slug: string
  project_id: string
  sort_order: number
}

export interface DocumentRec {
  id: string
  title: string
  slug: string
  project_id: string
  folder_id: string | null
  content: string
  /** A quick note has no title and a short nanoid slug; it lives at the workspace root. */
  is_quick_note: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

// A project member resolved with the member's profile info (from the list_project_members RPC).
export interface MemberInfo {
  user_id: string
  name: string | null
  email: string | null
  role: MemberRole
}
