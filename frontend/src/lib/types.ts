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

// ---- inline comments & suggested edits (Google-Docs style) ----

// How an annotation is pinned to the document. `source_start`/`source_end` (stored alongside) are
// exact 0-based offsets into the raw markdown — the primary anchor. This quote + surrounding context
// is the fuzzy fallback used to re-locate the highlight (or mark it orphaned) after the text changes.
export interface Anchor {
  quote: string
  prefix: string
  suffix: string
}

// A candidate for @mention autocomplete (from list_mentionable_users) — owner + members only.
export interface MentionableUser {
  id: string
  name: string | null
  email: string | null
  avatar_url: string | null
  member_role: string // 'owner' | 'viewer' | 'editor'
}

// Shapes mirror the list_document_* SECURITY DEFINER RPCs (author/resolver display info is joined
// server-side because the profiles table itself is private).
export interface CommentThread {
  id: string
  document_id: string
  project_id: string
  author: string | null
  author_name: string | null
  author_avatar_url: string | null
  anchor: Anchor
  source_start: number
  source_end: number
  resolved: boolean
  resolved_by: string | null
  resolver_name: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface CommentMessage {
  id: string
  thread_id: string
  author: string | null
  author_name: string | null
  author_avatar_url: string | null
  body: string
  mentions: string[]
  created_at: string
  updated_at: string
}

export interface SuggestionThread {
  id: string
  document_id: string
  project_id: string
  author: string | null
  author_name: string | null
  author_avatar_url: string | null
  anchor: Anchor
  source_start: number
  source_end: number
  original_md: string
  suggested_md: string
  created_at: string
  updated_at: string
}

export interface SuggestionMessage {
  id: string
  suggestion_id: string
  author: string | null
  author_name: string | null
  author_avatar_url: string | null
  body: string
  mentions: string[]
  created_at: string
  updated_at: string
}
