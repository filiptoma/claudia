-- 0021 — LaTeX project type.
-- Apply after 0001–0020 (single execution; no new tables, so the 0001 blanket grant gap does not
-- apply — `authenticated` already has DML on projects/documents). Adds COLUMNS only.
--
-- A LaTeX project is a normal project whose documents are .tex/.bib/asset files. Access control is
-- project-level only (Can view / Can edit) — the per-file/per-folder caps are never written for LaTeX
-- (the UI is hidden), so this migration also short-circuits the three cap-consulting helpers as
-- defense-in-depth: a stale/hand-inserted override can never restrict a LaTeX project.

-- ---------- 1. Columns ----------

-- (a) project type discriminator. Every existing row + the per-user workspace default to markdown
--     (the handle_new_user trigger in 0007 inserts the workspace without `type`, so it picks up this
--     default — no trigger change needed).
alter table public.projects
  add column if not exists type text not null default 'markdown'
  check (type in ('markdown', 'latex'));

-- (b) compile root for LaTeX projects (the main .tex). Self-FK to a document in the same project.
--     on delete set null: documents cascade-delete with the project, so this never dangles.
alter table public.projects
  add column if not exists main_document_id uuid
  references public.documents (id) on delete set null;

-- ---------- 2. RLS short-circuit: LaTeX ignores per-doc/per-folder caps ----------
-- Only these three helpers read access_override. Add `or p.type = 'latex'` to the cap clause so the
-- effective access for a LaTeX project collapses to project-level. `create or replace` keeps every
-- existing policy that calls them (documents_update/delete, folders_update/delete, documents_insert,
-- the annotation policies) wired unchanged — no policy DROP needed. (Mirrors 0020's bodies.)

create or replace function public.can_edit_document(p_doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.documents d
    join public.projects p on p.id = d.project_id
    left join public.folders f on f.id = d.folder_id
    where d.id = p_doc
      and public.can_edit_project(d.project_id)
      and (
        p.owner = auth.uid()
        or p.type = 'latex'                                   -- LaTeX ignores per-doc/folder caps
        or (
          coalesce(d.access_override, 'editor') = 'editor'
          and coalesce(f.access_override, 'editor') = 'editor'
        )
      )
  )
$$;

create or replace function public.can_comment_document(p_doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.documents d
    join public.projects p on p.id = d.project_id
    left join public.folders f on f.id = d.folder_id
    where d.id = p_doc
      and public.can_comment_project(d.project_id)
      and (
        p.owner = auth.uid()
        or p.type = 'latex'                                   -- LaTeX ignores per-doc/folder caps
        or (
          coalesce(d.access_override, 'editor') in ('commenter', 'editor')
          and coalesce(f.access_override, 'editor') in ('commenter', 'editor')
        )
      )
  )
$$;

create or replace function public.can_edit_folder(p_folder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.folders f
    join public.projects p on p.id = f.project_id
    where f.id = p_folder
      and public.can_edit_project(f.project_id)
      and (
        p.owner = auth.uid()
        or p.type = 'latex'                                   -- LaTeX ignores per-folder caps
        or coalesce(f.access_override, 'editor') = 'editor'
      )
  )
$$;
