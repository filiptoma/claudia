export type Role = 'basic' | 'mod' | 'admin'
export type MemberRole = 'viewer' | 'commenter' | 'editor'
export type Visibility = 'private' | 'shared' | 'public'
/** A project is either a markdown notes project or a LaTeX (Overleaf-style) project. See migration 0021. */
export type ProjectType = 'markdown' | 'latex'

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
  /** 'markdown' (the default for every existing project + the workspace) or 'latex'. */
  type: ProjectType
  /** LaTeX-only: the compile root (`main.tex`). NULL for markdown projects and freshly-created ones. */
  main_document_id: string | null
  is_workspace: boolean
  /** Baseline role granted to everyone who can access a PUBLIC project (no invite needed). */
  public_role: MemberRole
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
  /** Per-folder permission cap for everyone except the owner — caps the folder AND its documents.
   *  NULL = inherit. See migration 0020 and [[DocumentRec.access_override]]. */
  access_override: MemberRole | null
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
  /**
   * Per-document permission cap for everyone EXCEPT the project owner. NULL = inherit the project
   * role (default). Otherwise it can only restrict: 'commenter' downgrades editors to comment/suggest,
   * 'viewer' makes the document read-only for non-owners. Enforced in the DB (see migration 0018).
   */
  access_override: MemberRole | null
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

// ---- inline comments & suggested edits (annotations) ----

// How a highlight re-locates itself in the rendered text: the exact selected text plus a little
// surrounding context to disambiguate when the same phrase appears more than once. Source offsets
// (source_start/source_end on the rows) are the primary anchor; this is the display/fuzzy fallback.
export interface Anchor {
  quote: string
  prefix: string
  suffix: string
}

// A user who may be @mentioned in a project (owner + members), from list_mentionable_users.
export interface MentionableUser {
  id: string
  name: string | null
  email: string | null
  avatar_url: string | null
  member_role: string // 'owner' | MemberRole
}

// A comment thread anchored to a text range (from list_document_comment_threads). Supabase returns
// `anchor` as parsed jsonb, so it is typed as Anchor rather than a string.
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

// A single message within a comment thread (from list_document_comments).
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

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected'

// A suggested edit (from list_document_suggestions). `status` tracks its lifecycle: pending edits are
// shown inline; accepted/rejected ones are "resolved" (kept for review, then deletable as cleanup).
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
  status: SuggestionStatus
  created_at: string
  updated_at: string
}

// A reply/note on a suggestion (from list_document_suggestion_comments).
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
