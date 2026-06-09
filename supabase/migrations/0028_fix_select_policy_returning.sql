-- 0028 — Fix document/folder creation failing with "new row violates RLS" (42501) on INSERT.
-- Apply after 0023–0027 (dashboard SQL editor).
--
-- ROOT CAUSE (introduced by 0023)
--   0023 changed the SELECT policies from referencing the PARENT project
--       folders_select   USING (can_view_project(project_id))   -- pre-0023
--       documents_select USING (can_view_project(project_id))
--   to referencing the ROW ITSELF via STABLE SECURITY DEFINER helpers:
--       folders_select   USING (can_view_folder(id))            -- 0023
--       documents_select USING (can_view_document(id))
--   can_view_folder/can_view_document re-read the folder/document row BY ID. That is fine for normal
--   reads, but the app creates rows with PostgREST `return=representation` (.insert().select()), which
--   Postgres executes as  WITH t AS (INSERT ... RETURNING *) SELECT * FROM t. Postgres applies the
--   SELECT policy to the RETURNING rows — and a row inserted by the CURRENT statement is NOT visible to
--   a STABLE function evaluated within that same statement (MVCC command visibility). So the helper
--   returns false for the just-inserted row and the whole statement fails with 42501, even though the
--   INSERT's own WITH CHECK passed. (`return=minimal` inserts and plain reads were unaffected, which is
--   why this looked like an INSERT-policy problem but wasn't — 0027 was a no-op for it.)
--
-- THE FIX
--   Evaluate the two SELECT policies against the row's OWN COLUMN VALUES (passed directly into a helper),
--   so nothing re-reads the row being returned. The helpers still read only PRE-EXISTING tables
--   (projects, the parent folder, resource_grants), all visible inside the statement. Privacy semantics
--   are byte-for-byte identical to can_view_folder / can_view_document.
--
--   can_view_folder(uuid) / can_view_document(uuid) are LEFT IN PLACE unchanged — they're still used by
--   comment/suggestion/media/realtime policies and the list_* RPCs, which always reference a PRE-EXISTING
--   document/folder and therefore never hit this RETURNING-visibility problem.

-- ── folders ────────────────────────────────────────────────────────────────
create or replace function public.can_view_folder_cols(p_id uuid, p_project uuid, p_is_private boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_project_owner(p_project)                                    -- owner (reads projects)
    or (not p_is_private and public.can_view_project(p_project))          -- non-private: public/member
    or (exists (select 1 from public.projects p where p.id = p_project and p.type = 'latex')
        and public.can_view_project(p_project))                          -- latex: project-level
    or (p_is_private and exists (                                         -- private: explicit folder grant
          select 1 from public.resource_grants g
          where g.folder_id = p_id and g.user_id = auth.uid()))
$$;
grant execute on function public.can_view_folder_cols(uuid, uuid, boolean) to anon, authenticated;

drop policy if exists folders_select on public.folders;
create policy folders_select on public.folders for select
  using (public.can_view_folder_cols(id, project_id, is_private));

-- ── documents ──────────────────────────────────────────────────────────────
create or replace function public.can_view_document_cols(
  p_id uuid, p_project uuid, p_folder uuid, p_is_private boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_project_owner(p_project)                                    -- owner
    or (exists (select 1 from public.projects p where p.id = p_project and p.type = 'latex')
        and public.can_view_project(p_project))                          -- latex: project-level
    or (case
          when p_is_private then                                          -- doc independently private
            exists (select 1 from public.resource_grants g
                    where g.document_id = p_id and g.user_id = auth.uid())
          when coalesce((select is_private from public.folders where id = p_folder), false) then
            exists (select 1 from public.resource_grants g                -- inherits a private parent folder
                    where g.folder_id = p_folder and g.user_id = auth.uid())
            or exists (select 1 from public.resource_grants g
                       where g.document_id = p_id and g.user_id = auth.uid())
          else
            public.can_view_project(p_project)                            -- non-private: unchanged
        end)
$$;
grant execute on function public.can_view_document_cols(uuid, uuid, uuid, boolean) to anon, authenticated;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select
  using (public.can_view_document_cols(id, project_id, folder_id, is_private));
