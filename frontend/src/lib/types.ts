export type Role = 'basic' | 'mod' | 'admin'
export type MemberRole = 'viewer' | 'editor'
export type Visibility = 'private' | 'shared' | 'public'

export interface Profile {
  id: string
  email: string | null
  name: string | null
  role: Role
  created_at: string
}

export interface Project {
  id: string
  name: string
  slug: string
  owner: string | null
  is_public: boolean
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
