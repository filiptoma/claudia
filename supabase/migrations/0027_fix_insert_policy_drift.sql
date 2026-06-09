-- 0027 — Repair INSERT-policy drift on documents/folders. Apply after 0023–0026 (dashboard SQL editor).
--
-- WHAT HAPPENED
--   On dev (and prod) the `documents_insert` and `folders_insert` policies had been rewritten OUT OF
--   BAND to call `can_edit_project_uid(project_id, (select auth.uid()))`,
--   `can_edit_folder_uid(folder_id, (select auth.uid()))` and
--   `is_project_owner_uid(project_id, (select auth.uid()))` — `_uid`-suffixed helper variants that exist
--   ONLY in the live database, never in this repo (the likely source is the Supabase Performance Advisor
--   "auth_rls_initplan" auto-fix, or a manual optimization). Those variants return FALSE even for the
--   project owner, so every document/folder/quick-note INSERT failed with
--   "new row violates row-level security policy". Every other policy (select/update/delete) still used
--   the correct, repo-matching helpers — which is why only CREATION broke.
--
-- THE FIX
--   Re-assert both INSERT policies with their canonical definitions (folders_insert from 0001;
--   documents_insert from 0023), which call the audited `can_edit_project` / `can_edit_folder` /
--   `is_project_owner` helpers used everywhere else. Idempotent (drop if exists + create).
--
--   These canonical expressions contain NO bare `auth.uid()` (the lookup happens once inside each
--   SECURITY DEFINER helper), so the Performance Advisor will not re-flag them — restoring them is
--   stable, not a regression that gets auto-"fixed" again.
--
--   The orphaned `*_uid` helper functions are left in place (harmless once unreferenced); drop them
--   separately only after confirming no other policy/table still references them.

-- folders_insert — canonical (0001): project edit access.
drop policy if exists folders_insert on public.folders;
create policy folders_insert on public.folders for insert
  with check (public.can_edit_project(project_id));

-- documents_insert — canonical (0023): folder cap (or project edit at root), and creating an
-- already-private doc is owner-only.
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert
  with check (
    case
      when folder_id is not null then public.can_edit_folder(folder_id)
      else public.can_edit_project(project_id)
    end
    and (not is_private or public.is_project_owner(project_id))
  );
