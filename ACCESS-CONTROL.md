# Access Control & Permissions — Current State

This document describes the access-control system of the AstroNote (internal codename "Claudia") markdown notes app exactly as it exists today. It is a description of the current behavior, not a proposal. It covers what resources exist, who owns them, the roles and privacy states, the mechanisms for granting access, how the effective decision is computed, and where each control lives in the UI. A short closing section neutrally lists the overlapping surfaces observed during this review.

## 1. Overview

Every piece of user content is rooted in a **project**, which has exactly one **owner** (`projects.owner`). A project may be private, public, or the user's special "My Workspace". On top of a project sit two layers of finer-grained control for markdown projects: per-resource **privacy** (`is_private` on folders/documents, which *hides* a resource so only the owner and explicitly granted users can reach it) and a per-resource **access cap** (`access_override`, which can only *lower* what a person could otherwise do — never raise it, never hide). Access is granted four ways: by being the owner, by being added to the project (`project_members`), by holding a per-resource grant (`resource_grants`), and by a project-wide "public baseline" (`public_role`) that everyone gets on a public project. The database (Postgres Row-Level Security) is the real enforcement layer; the frontend mirrors the same rules only to show or hide controls. The whole model is fail-closed: when a rule can't be evaluated, access is denied.

## 2. Resources & Ownership

### The hierarchy

```
profiles (user identity + global role)
  └─ owns → projects            (owner uuid → profiles.id)   [the ONLY place ownership lives]
                ├─ folders        (project_id → projects.id, cascade)   [one flat level, optional]
                │     └─ documents (folder_id → folders.id, cascade)
                ├─ documents      (project_id → projects.id; folder_id NULL = project root)
                └─ media objects  (Storage bucket 'media', path {project_id}/... or {project_id}/{document_id}/...)
   └─ project_members  (project_id, user_id, role)   — sharing ACL, NOT part of the content tree
   └─ resource_grants  (folder_id XOR document_id, user_id, role)   — per-resource grants
```

- The hierarchy is strictly three levels: **project → folder → document**. Folders never nest (no folder-to-folder parent). A document always belongs to a project and optionally to one folder; `folder_id = NULL` means it sits at the project root.
- **Ownership lives only on `projects.owner`** (a single uuid foreign key to `profiles.id`). Folders, documents, and media have **no owner column** — they inherit access entirely from their project. A folder or document cannot be owned independently of its project.

### The ownership column

- `projects.owner` is `ON DELETE SET NULL`. Deleting a user therefore leaves their projects in place but **ownerless** (owner becomes `NULL`). An ownerless project is then visible/editable by no one, because every access check compares against `owner = auth.uid()`, which can never match `NULL`.

### Media

Media is **not a table**. Uploaded images are Storage objects in a private bucket named `media`. The object path is either `{project_id}/filename` (legacy, project-scoped) or `{project_id}/{document_id}/filename` (current, document-scoped). Access is derived from the path: a document-scoped object is gated by who can view that document; a legacy project-scoped object is gated by who can view the project.

### Quick notes

A "quick note" is not a separate type. It is an ordinary root document (`folder_id = NULL`) inside My Workspace, flagged with `documents.is_quick_note = true`, titleless, with a short generated slug. It is surfaced in a dedicated "Quick notes" UI section but is governed by the same policies as any other document.

### Project type

`projects.type` is `'markdown'` (default) or `'latex'`. The distinction matters for access: **LaTeX projects ignore per-resource privacy and caps** — every per-folder/per-document access check delegates straight to the project-level decision. Per-resource privacy and the `access_override` cap are markdown-only features.

### Admin / staff / "official" projects

- The global role lives on `profiles.role` (`user_role` enum: `'basic'`, `'mod'`, `'admin'`). **mod + admin = "staff"** (`is_staff()`); `admin` alone is checked by `is_admin()`.
- There is **no admin-owned or "official"/platform-owned project concept**. Every project's owner is always a real end-user (or `NULL` after deletion). "admin" only confers cross-cutting reach over public projects (see roles) plus the `admin_projects()` management RPC, which lists every non-workspace project with its owner's name/email (fail-closed: staff only, errcode `42501` otherwise).

### My Workspace

"My Workspace" is a normal project row with `is_workspace = true`, slug `'my'`, `is_public = false`, auto-created once per user (one per owner enforced by a partial unique index). It is **owner-only** even for staff. Every access helper short-circuits a workspace to owner-only, and triggers block renaming, sharing, publishing, deleting it, or converting a regular project into a workspace. Membership and resource grants cannot exist on a workspace (trigger-blocked).

## 3. Roles & Permission Levels

There are **two unrelated role vocabularies**, both spelled "role":

- **Global role** (`profiles.role`, type `user_role`): `'basic'` | `'mod'` | `'admin'`. `mod` and `admin` together are "staff".
- **Per-resource role** (type `member_role`, ordered `viewer` < `commenter` < `editor`): used by `project_members.role`, `resource_grants.role`, `public_role`, `access_override`, and `invite_links.role`. There is **no `'owner'` value** in this enum — ownership is the `projects.owner` column, not a role. (The string `'owner'` appears only as a synthetic display label in mention/listing RPCs.)

The three per-resource tiers:

- **`viewer`** — read only. No commenting, no suggesting, no editing.
- **`commenter`** — read + create comments and suggestions; cannot edit document content or accept/reject suggestions.
- **`editor`** — full read/write of content; can apply/reject suggestions; on a private resource an editor grant additionally lets the holder create docs in a private folder and rename/delete that folder.

The project **owner** sits above all tiers and is exempt from every cap and from privacy.

### Capability matrix

Rows are the distinct effective roles a user can hold against a **non-workspace markdown** resource. Cells: yes / no / partial. Variations for workspace and LaTeX projects follow the table.

| Role | Read | Comment | Suggest (create) | Edit content | Manage structure (folders/docs) | Invite others | Change privacy (`is_private` / `is_public` / `public_role`) | Delete resource | Accept/reject suggestions |
|---|---|---|---|---|---|---|---|---|---|
| **Project owner** (`projects.owner = auth.uid()`) | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| **Admin** (`role='admin'`) on a **public** project (non-member) | yes | yes | yes | yes | yes | yes (mint invite links) | partial — can flip `is_public`/`public_role` & delete project; **cannot** set `is_private`/`access_override`/`resource_grants` (owner-only) | yes | yes |
| **Admin** on a **private** project (non-member) | no | no | no | no | no | no | no | no | no |
| **Mod** (`role='mod'`) on a **public** project (non-member) | yes | yes | yes | yes | yes | no (manage is admin-only) | no | no | yes |
| **Mod** on a **private** project (non-member) | no | no | no | no | no | no | no | no | no |
| **Member: editor** (`project_members.role='editor'`) | yes | yes | yes | yes | yes | no | no | partial — delete own/resolved annotations only; not the project | yes |
| **Member: commenter** | yes | yes | yes | no | no | no | no | no (withdraw own pending annotations only) | no |
| **Member: viewer** | yes | no | no | no | no | no | no | no | no |
| **Public baseline `public_role='editor'`** (signed-in non-member on public project) | yes | yes | yes | yes | yes | no | no | no | yes |
| **Public baseline `public_role='commenter'`** | yes | yes | yes | no | no | no | no | no | no |
| **Public baseline `public_role='viewer'`** (default) / any signed-in user on a public project | yes | no | no | no | no | no | no | no | no |
| **Anonymous (logged-out)** on a public project | partial — table rows readable via RLS where `anon` has SELECT; comments/suggestions are authenticated-only and unreachable | no | no | no | no | no | no | no | no |
| **Resource grant: editor** (on a **private** folder/doc) | yes (that resource) | yes | yes | yes | partial — create docs in / rename / delete that private folder; not other resources | no | no | partial — delete docs/annotations within grant scope; not the project | yes |
| **Resource grant: commenter** (private folder/doc) | yes (that resource) | yes | yes | no | no | no | no | no | no |
| **Resource grant: viewer** (private folder/doc) | yes (that resource) | no | no | no | no | no | no | no | no |
| **Non-grantee** on a private folder/doc (even a project editor/owner-equivalent who lacks a grant) | no | no | no | no | no | no | no | no | no |

**Variations that override the matrix:**

- **Workspace (`is_workspace=true`):** every helper short-circuits to owner-only. Owner = all yes; everyone else (members, staff, public baseline) = all no. Membership and resource grants cannot exist on a workspace. Even the owner cannot rename/delete/share/publish the workspace itself (trigger-blocked).
- **LaTeX project (`type='latex'`):** per-resource caps (`access_override`) and per-resource privacy (`is_private`) are ignored — every resource helper delegates to the project-level helper. A LaTeX project's editor/commenter/viewer has the same project-level capability uniformly across all folders and docs; there is no private-resource or cap row.
- **Comment "accept/reject" column for comments specifically** = resolving a thread: a comment thread's **author** may also resolve it regardless of edit rights. For suggestions, only an editor/owner can accept/reject (the author may only withdraw a suggestion while it is pending).
- **"Suggest (create)" / "Comment"** require at least commenter tier on the parent. Note that **replying** to an existing thread/suggestion is gated at the *project* level, not the per-document level — see Section 8.

## 4. Privacy States

Privacy is expressed differently at the project level versus the resource level.

### Project level

- **Private** (default): `is_public = false`. Visible only to the owner, project members, and (for public-flag purposes, none) staff have no reach into private projects. New projects are created private.
- **Public**: `is_public = true`. Readable by anyone (including logged-out visitors at the row level), and listed on the public browse page by `list_public_projects()` (which returns every project where `is_public = true` and `is_workspace = false`).
- **Public baseline (`public_role`)**: a public project additionally carries `public_role` (`member_role`, default `viewer`). This is the tier every **signed-in** visitor of the public project gets with no invite — `viewer` (read), `commenter` (comment/suggest), or `editor` (edit). The elevated tiers (`commenter`/`editor`) apply only to signed-in users; logged-out users never get the elevated baseline.
- **Workspace**: a third, special state — `is_workspace = true`, always owner-only, cannot be made public.

There is no separate "publicly-listed" flag: being listed on the public browse page is a direct consequence of `is_public = true` (and not a workspace). "Public" and "publicly listed" are the same thing.

### Resource level (markdown only)

- **`folders.is_private`** / **`documents.is_private`** (boolean, default `false`): when `true`, the resource is **hidden** from everyone — public visitors, project members, even project editors — *except* the owner and users holding an explicit `resource_grants` row. A document inside a private folder is private too (it inherits the folder's grantees), even if its own `is_private = false`.
- Privacy defaults to off; resources follow project access until made private.
- Only the **project owner** may flip `is_private` (enforced by `protect_folder_privacy` / `protect_document_privacy` triggers). A non-owner also cannot move a document into or out of a private folder (`protect_document_move`).

A separate column, **`access_override`** (`member_role`, nullable, `NULL` = inherit), is *not* a privacy state — it is a downgrade cap that lowers what comment/edit a person can do but **never hides** a resource. It is covered under access computation below.

## 5. How Access Is Granted

There are five distinct mechanisms.

### (a) Ownership

Creating a project (`createProject`, which inserts `owner = auth.uid()`, `is_public = false`) makes the creator the owner. The owner has every capability on every resource in the project, is exempt from all caps and privacy, and is the only principal who may flip `is_private`, set/clear caps, write `resource_grants` directly, and move documents across private boundaries. Ownership is not transferable through these flows (it only changes via the `ON DELETE SET NULL` on user deletion).

### (b) Direct grant / invite a person to a project, folder, or document

- **To a whole project:** the owner (or staff manager) adds a `project_members` row via `addMember` (an upsert of `{project_id, user_id, role}`). The recipient gets that `member_role` across all non-private resources in the project.
- **To a private folder or document:** the owner inserts a `resource_grants` row via `setResourceGrant` (`folder_id` XOR `document_id`, `user_id`, `role`). The recipient gets that role scoped to that single resource (a folder grant cascades to the docs inside it). Direct `resource_grants` writes are **owner-only** (RLS `rg_insert`/`rg_update`/`rg_delete`).
- **Granting-pool rule:** on a non-public project, a `resource_grants` row may only be created for someone who is *already* a project member or the owner (enforced by the `set_resource_grant_project` trigger). So a private-resource invite cannot by itself onboard an outsider to a private project — they must be added to the project first.
- Email lookup for both flows is done via `find_profile_by_email` (returns id/name/email only, never role — to preserve `profiles` privacy).

### (c) Invite links

- **Minting:** `create_invite_link(p_project, p_folder, p_document, p_role, p_expires_at, p_max_uses)` — gated by `can_manage_project` (owner or admin-on-public). The token is generated server-side (~244 bits), returned once. A link targets the whole project (both folder/doc NULL) or one folder/doc (resource-level links are markdown-only). At most one active (non-revoked) link per target+role.
- **Storage:** `invite_links` rows; the token is stored in plaintext but the table is **manager-only** under RLS (redeemers can never read it, preventing token harvesting). Links are revocable (`revoked`), can expire (`expires_at`), and can be use-limited (`max_uses`).
- **Redemption:** `redeem_invite(p_token)` (SECURITY DEFINER, sign-in required). It validates revoked/expired/use-limit under a row lock, then:
  - **Project target** → upserts `project_members` with `role = greatest(existing, new)` (never downgrades).
  - **Folder/document target** → if the project is private and the redeemer is **not already a member**, it rejects with "This invite is for project members only — ask the owner to add you to the project first"; otherwise upserts `resource_grants` with `greatest(...)`.
- The recipient does **not** choose their role — it is carried on the link row. The frontend invite page (`InvitePage.tsx`) auto-redeems after sign-in and redirects, without ever displaying which role will be granted.

### (d) Making a resource public

The owner (or admin-on-public) sets `projects.is_public = true` (`setProjectPublic`) and optionally raises `public_role` (`setProjectPublicRole`). This makes the project readable by everyone and grants every signed-in visitor the `public_role` baseline tier with no per-person invite. Per-resource `is_private` is the inverse, owner-only operation (hiding a folder/doc within an otherwise-accessible project).

### (e) Public baseline read

On any public project, the underlying row read (`can_view_project`, `projects_select`) is **not** gated on being signed in, so even logged-out visitors can read public-project rows to the extent the `anon` database role has table SELECT grants. The elevated baselines (comment/edit via `public_role`) require sign-in. The comment/suggestion tables and RPCs are authenticated-only, so a logged-out user can read content but cannot reach the annotation layer at all.

## 6. How Effective Access Is Computed

The effective decision for a (user, resource, action) is computed top-down inside the SECURITY DEFINER resource helpers (`can_view_*`, `can_comment_*`, `can_edit_*`), and the same order is mirrored in the frontend `access.ts`. **The order is strict — the first matching branch decides; later layers are never consulted.**

1. **Project owner short-circuit (highest).** `projects.owner = auth.uid()` → always allowed. The owner is exempt from every cap and from `is_private`.

2. **LaTeX short-circuit.** If `projects.type = 'latex'`, the resource helper delegates straight to the project-level helper. Caps and privacy are ignored entirely.

3. **Privacy branch (supersedes the cap entirely).** Evaluated on the document's `is_private`, then the parent folder's `is_private`:
   - If the **document** is private → access derives ONLY from a `resource_grants` row on **that document** (view = any grant role; comment = `commenter`|`editor`; edit = `editor`). Project role, public baseline, and `access_override` are all ignored.
   - Else if the **parent folder** is private → access derives from a folder grant OR a document grant (a folder grant cascades to every doc inside it; a doc may additionally carry its own grant).
   - A doc can be independently private inside a non-private folder; a doc inside a private folder inherits the folder's grantees.

4. **Non-private (default) branch = project role, capped.** Falls to `can_*_project`, which folds in, in order: workspace → owner-only; else owner; OR member with the required role; OR staff-on-public (comment/edit only, and only on **public** projects); OR the public baseline (`public_role`, signed-in users only). That project-level result is then narrowed by the `access_override` caps:
   - **Edit** requires **both** the document cap and the folder cap to be `editor` (most restrictive wins; a root doc has no folder, so that side imposes no restriction).
   - **Comment** requires both caps to be in (`commenter`, `editor`).
   - **View ignores caps** — a cap never hides. View on a non-private resource reduces exactly to `can_view_project`. So a `'viewer'` cap is a comment/edit ceiling, not a visibility control.

### Inheritance / cascade (one line each)

- **Project membership / `public_role`** cascades down to all **non-private** folders and documents.
- **A folder's `access_override` cap** cascades to every document inside it; a doc's effective cap is the *minimum* of its own cap and its folder's cap.
- **A private folder's grants** cascade to every document inside it; they do **not** cascade upward or to sibling folders.
- **A private resource's grants** are scoped to that folder (and its docs) or that single doc; they never cascade outside. Whole-project access from an invite goes to `project_members`, never to `resource_grants` (which is folder/doc-scoped by CHECK constraint).

### Authority to change the model

Despite "manage" being broader, the authority to change the access model is **owner-only**: `is_private`, `access_override`, and direct `resource_grants` writes are all owner-only (triggers + RLS). `can_manage_project` (owner OR admin-on-public) only additionally authorizes minting/listing/revoking invite links and managing project membership — an admin-on-public can mint invites but cannot set caps, privacy, or grants directly.

### Anonymous / public users

A logged-out user has `auth.uid() = NULL`. They can read public-project rows where the `anon` role has table SELECT and RLS permits it, but every private branch evaluates false for them, and the annotation/RPC layer (comments, suggestions, mentions, invite redemption) is authenticated-only and unreachable.

## 7. Comments & Suggestions

Two parallel annotation tracks sit on documents: **comment threads** (`comment_threads` + `comments`) and **suggested edits** (`suggestion_threads` + `suggestion_comments`). The `commenter` tier exists specifically for this layer.

- **Create a comment thread or a suggestion**: requires `can_comment_document` (commenter tier or above on the parent; gated through the per-resource cap and, on a private resource, the grant).
- **Reply** to an existing thread or suggestion: gated on `can_comment_project` (the project-level commenter check), **not** the per-document check (see Section 8).
- **Edit your own message**: author-only, and only while the thread is **open** (comment) / the suggestion is **pending**.
- **Resolve a comment thread**: an UPDATE permitted to the thread **author** OR any editor/owner. The author can self-resolve their own thread.
- **Accept a suggestion** (`apply_suggestion`) / **reject a suggestion** (`reject_suggestion`): **editor/owner only** (SECURITY DEFINER, re-checks `can_edit_document`, requires `status = 'pending'`; accept also does a stale-safety check before splicing the suggested text into the document). The suggestion **author** can only **withdraw** their own suggestion while it is still pending.
- **Lifecycle**: comment threads are `OPEN` → `RESOLVED`; suggestions are `pending` → `accepted` / `rejected`. Once resolved/non-pending, a thread is read-only (no new replies, no message edits); editors may then delete it (resolve-before-delete). Authors may delete their own only while it is open/pending.
- **@mentions**: validated fail-closed — a mention target must be able to view the document (`can_user_view_document`), so you cannot leak a private doc by mentioning a non-grantee. On a public project any registered user may be mentioned; on a private project mentions are members-only. Mentions carry **no** access grant — they are a notification mechanism only.

## 8. Enforcement (RLS)

Security is enforced almost entirely in Postgres via Row-Level Security; every policy delegates to STABLE SECURITY DEFINER helper functions that read base tables directly (to avoid RLS recursion). The helpers are the real policy logic. The posture is deliberately **fail-closed**.

Per-table summary (plain English):

- **`projects`**: you can SELECT a project if it's public, you own it, or you're a member; a workspace is owner-only (hidden even from staff). You can only INSERT a project you own. UPDATE/DELETE = owner, or an admin on a public project.
- **`project_members`**: you can see your own membership; the owner and staff see/manage the full list. Invite redemption bypasses these as a definer function.
- **`folders`**: SELECT via the privacy-aware helper (owner / non-private→project view / latex→project view / private→explicit folder grant). INSERT requires project-edit. UPDATE/DELETE require `can_edit_folder`.
- **`documents`**: SELECT via the privacy-aware helper (owner / latex / doc-private→doc grant / folder-private→folder-or-doc grant / else project view). INSERT requires folder-edit (or project-edit for root docs) **and** is owner-only if the new row is already private. UPDATE/DELETE require `can_edit_document` (caps stack project→folder→doc, most restrictive wins).
- **Media (`storage.objects`, bucket `media`)**: private bucket; SELECT gated on view of the owning document (3-segment path) or project (legacy 2-segment); INSERT/DELETE gated on edit. Bucket is capped at 10MB and restricted to raster image MIME types (SVG excluded as an XSS vector).
- **Comments / suggestions**: SELECT gated on `can_view_document`; thread/suggestion creation on `can_comment_document`; replies on `can_comment_project`; moderation/delete on `can_edit_document` plus author self-access. The accept/reject RPCs re-check `can_edit_document`.
- **`resource_grants`**: you can see your own grant (or all of them if you're the owner). INSERT/UPDATE/DELETE are owner-only; redeem bypasses as definer. A trigger forces `project_id` from the real target (anti-spoofing) and enforces the private-project members-only granting pool. `anon` has SELECT but RLS returns zero rows to it.
- **`invite_links`**: all operations are manager-only (`can_manage_project`); redeemers never read the table. `anon` has no grant at all.
- **`document_collab` (Yjs co-editing) / `realtime.messages`**: presence requires view; pushing a co-edit broadcast requires edit; logged-out users are excluded (`to authenticated`).

**Security posture:**
- **Fail-closed everywhere**: SECURITY DEFINER RPCs re-check `auth.uid()` and access before acting; topic/path parsers return false/NULL on any parse miss; unevaluable checks deny.
- **SECURITY DEFINER RPCs** (`redeem_invite`, `create_invite_link`, `apply_suggestion`, `reject_suggestion`, `admin_projects`, the `list_*` helpers, the `can_*` helpers) carry the privileged operations and re-validate access internally so they can safely bypass table RLS where needed.
- **`anon` exposure** is deliberately narrow: SELECT on a handful of tables (with RLS still returning zero private rows) and EXECUTE on the `can_view_*` helpers that public reads need; everything sensitive is revoked from `anon`/`public`.

There are several **known discrepancies** between the enforced rules and the frontend mirror (all observations of current behavior, not bugs being fixed here):

- **Replies are gated at the project level, not the document level.** `c_insert`/`sc_insert` check `can_comment_project`, while the frontend `canCommentDocument` applies the per-resource cap and the private-resource grant. A project-level commenter who is capped to `viewer` on a document (or who is a non-grantee on a private doc) is blocked by the UI from replying, yet the insert policy would permit it *if* they obtained the thread id. The leak is mitigated only by SELECT-side hiding (they normally cannot learn the thread id) — RLS here is looser than the frontend and is defended by visibility rather than by the insert policy.
- **The `'viewer'` cap is labeled "View only" in the UI but does not hide.** RLS never hides on a cap; a doc capped to `viewer` remains fully readable by everyone who can read the project. The cap only blocks comment/edit, so "View only" overstates the effect (it is "read-only", not "hidden").
- **Admin-on-public is a broad, easy-to-miss reach.** A global `admin` can manage (settings/delete/re-share) any public project they don't own. Mods are correctly excluded.
- **The UI is slightly optimistic about anonymous capability.** It treats a logged-out user as a "viewer" of a public project, but the annotation tables/RPCs are authenticated-only, so an anonymous user cannot actually reach comments/suggestions.
- **Legacy 2-segment media paths stay project-scoped.** Images embedded before the document-scoped media change remain gated by `can_view_project`, so such an image inside a later-private document can leak to any project viewer — RLS here is looser than the privacy model the lock icon implies.
- **Two parallel SELECT-helper families exist** for identical semantics: `can_view_folder`/`can_view_document` (used by comment/suggestion/media/realtime/list paths) and `can_view_folder_cols`/`can_view_document_cols` (used only by the table SELECT policies, to dodge an INSERT...RETURNING visibility trap). They must be kept in lockstep; the frontend mirrors only one logical rule.
- **Repo-vs-live drift is a documented real risk.** The Supabase Performance Advisor has rewritten live INSERT policies out-of-band to `_uid`-suffixed helpers; the live DB can diverge from the migration files, so live policies should be dumped before relying on the repo text.

## 9. Where These Controls Live in the UI

Access controls funnel through **one settings page** (`ProjectSettings.tsx`) but render across three surfaces. There are three React rendering surfaces with access logic, but only **two user-facing entry points**: the Project settings page, and the per-resource "Manage" dialog launched from within it. `ActionsMenu.tsx` and `AppHeader.tsx` contain **no** access controls — the header only navigates to "Project settings".

### `ProjectSettings.tsx` — the hub

Gated by `canConfigureProject` (owner/admin-on-public), hidden entirely for workspaces. It holds six project-level clusters:

1. **Public/private toggle** — `Switch` → `setProjectPublic`. (Label flips Public / Shared / Private.)
2. **Public default-role select** — `RoleSelect` → `setProjectPublicRole` (sets `public_role`; warns when set to `editor`).
3. **Invite-by-email form** — email + role → `findUserByEmail` then `addMember` (writes `project_members`).
4. **Member list** — per-member `RoleSelect` → `addMember` (upsert) + remove (`Trash`) → `removeMember`.
5. **Project-level share-link manager** — `InviteLinksManager` with target omitted (`create_invite_link` / `revokeInviteLink`).
6. **"Private folders & documents" table** — `AccessRow` per folder/non-quick-note doc, each with a "Private" badge and a "Manage" button. These are the **only** launcher of `PermissionsDialog`.

### `PermissionsDialog.tsx` — the per-resource modal

A single app-level modal (`PermissionsDialogContext`), opened only from the `ProjectSettings` AccessRow "Manage" button. For one folder/document it surfaces **two orthogonal restriction models**:

1. Embeds `ResourceAccessManager` (privacy toggle + grants).
2. When the resource is **not** private, a separate access-cap `Select` (inherit / "Comment only" / "View only") → `setFolderAccessOverride` / `setDocumentAccessOverride`.

### `ResourceAccess.tsx` (`ResourceAccessManager` + `InviteLinksManager`)

- **Per-resource Private toggle** → `setFolderPrivate` / `setDocumentPrivate`.
- **GranteesManager** — its add-control swaps by project visibility: invite-by-email (public projects) vs. add-existing-member dropdown (private projects), both → `setResourceGrant`; plus per-grantee `RoleSelect` and remove → `removeResourceGrant`.
- **Resource-scoped `InviteLinksManager`** → `createInviteLink` / `revokeInviteLink`.

### Visual distinctions elsewhere (read-only cues, not controls)

- `ProjectGlyph` icon: `Library` (workspace), blue `Globe` (public), `Users` (shared), `Lock` (private). There is no distinct "shared with me" cue — owned and shared-with-me projects sit in the same "Projects" grid, differentiated only by the `Users` vs `Lock` glyph.
- Small `Lock` icons in the sidebar mark per-resource privacy on folder/document rows.
- The public browse page (`PublicProjectsPage.tsx`, `PublicProjectCard.tsx`) shows no privacy glyph — every card there is public by definition.

## 10. Observed Friction / Complexity

The following are neutral observations of redundant or overlapping surfaces noted during this review; they are not recommendations.

- **Two genuinely different restriction models apply to the same resource.** A single folder/document carries both privacy + grants (`is_private` + `resource_grants`) and the `access_override` cap. The `PermissionsDialog` shows the cap only when the resource is not private, but the configurer still confronts both concepts for one item.
- **Four different role-bearing controls** can bear on overlapping outcomes: project `public_role`, per-member role, per-resource grant role, and the resource cap.
- **Invite-by-email appears at two levels** with near-identical UI but different write targets — project level (`addMember` → `project_members`) vs. resource level (`setResourceGrant` → `resource_grants`).
- **Share-link creation appears at two levels** via the same `InviteLinksManager` component — whole-project links (target omitted) and per-resource folder/document links.
- **`RoleSelect` is implemented twice** — a local copy in `ProjectSettings` and a separate one in `ResourceAccess`, with divergent prop shapes.
- **Privacy state is represented twice** for the same resource — the `AccessRow` shows a "Private" badge, while the dialog it launches re-shows the same state as an editable Private `Switch`.
- **The same "give this person access" action has two different UIs** depending on project visibility — invite-by-email (public) vs. add-existing-member dropdown (private).
- **The "View only" cap label overstates its effect** — it is read-only, not hidden (the cap never removes read access).
- **The recipient's invite role is invisible in the redemption flow** — `InvitePage` never displays which tier will be granted before or after accepting.
- **A members-only precondition on private-resource links is not surfaced.** A non-member who clicks a private folder/document link hits the generic "Invite unavailable" error rather than a "join the project first" explanation.
- **A stale comment remains.** `PermissionsDialogContext` still claims it is opened from folder/document action menus, but after the "drop permissions dialog from ProjectHome" change the dialog is reachable only from the `ProjectSettings` "Manage" buttons.
