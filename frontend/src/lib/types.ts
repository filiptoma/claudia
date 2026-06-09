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
  /** 'markdown' | 'latex' — from list_public_projects (migration 0022) or a direct projects select. */
  type: ProjectType
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
  /** Private folder (Discord private-channel model, markdown only — migration 0023): hidden from
   *  everyone except the owner and users with a `resource_grants` row on it. Orthogonal to the
   *  access_override cap; when true, the grant role (not the project role/cap) defines access. */
  is_private: boolean
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
  /** Private document (markdown only — migration 0023): hidden from everyone except the owner and
   *  users granted access to it (or to its parent folder). A doc inside a private folder is private
   *  too, even with is_private=false. Orthogonal to the access_override cap; privacy supersedes it. */
  is_private: boolean
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

// ---- private-resource grants & invite links (migrations 0023 + 0024) ----

// A row of resource_grants the current user can read (their own grants + every grant on a project they
// own). Exactly one of folder_id / document_id is set. Used to compute the user's tier on a private
// folder/document; the DB is the real gate.
export interface ResourceGrant {
  id: string
  project_id: string
  folder_id: string | null
  document_id: string | null
  user_id: string
  role: MemberRole
  created_by: string | null
  created_at: string
}

// A grantee resolved with profile info (from the list_resource_grants RPC — owner-only).
export interface ResourceGrantInfo {
  user_id: string
  name: string | null
  email: string | null
  avatar_url: string | null
  role: MemberRole
  created_at: string
}

// A share link the manager can read (RLS manager-only). folder_id/document_id both null = whole-project
// invite. The raw `token` is only returned by create_invite_link and re-read here for re-display.
export interface InviteLink {
  id: string
  token: string
  project_id: string
  folder_id: string | null
  document_id: string | null
  role: MemberRole
  created_by: string | null
  expires_at: string | null
  max_uses: number | null
  uses: number
  revoked: boolean
  created_at: string
}

// The result of redeeming an invite link (from redeem_invite) — slugs let the caller redirect to the
// target it just unlocked.
export interface RedeemResult {
  project_id: string
  project_slug: string | null
  folder_slug: string | null
  document_slug: string | null
  kind: 'project' | 'folder' | 'document'
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
