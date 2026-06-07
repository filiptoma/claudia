-- 0020 — extend the per-document permission cap to FOLDERS, making the model three levels:
--   project role  →  folder cap  →  document cap
-- Apply after 0001–0019 (single execution; no enum changes).
--
-- A folder's cap restricts everyone EXCEPT the project owner for the folder itself AND every document
-- inside it; a document's own cap stacks on top. Effective access = the most restrictive of the three.
-- Caps only ever RESTRICT (never grant access a person's project role doesn't already give).
--
-- Ownership note: only the PROJECT OWNER may set or clear a cap, and the owner is never affected by one
-- (so they can always edit and unlock their own content). This supersedes 0018's manager-level rule —
-- otherwise a non-owner manager could lock a doc/folder and then be unable to unlock it (the cap would
-- block their own UPDATE). The private "My workspace" is owner-only and never shows the control, so caps
-- there are moot.

-- ---------- 1. The folder override column ----------
alter table public.folders
  add column if not exists access_override public.member_role;

-- ---------- 2. can_edit_folder: project edit access AND the folder's own cap permits editing ----------
-- Gates renaming/deleting the folder and creating documents inside it. (Owner bypasses the cap.)
create or replace function public.can_edit_folder(p_folder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.folders f
    join public.projects p on p.id = f.project_id
    where f.id = p_folder
      and public.can_edit_project(f.project_id)
      and (p.owner = auth.uid() or coalesce(f.access_override, 'editor') = 'editor')
  )
$$;
revoke all on function public.can_edit_folder(uuid) from public, anon;
grant execute on function public.can_edit_folder(uuid) to authenticated;

-- ---------- 3. Fold the folder cap into the document-level helpers ----------
-- Effective doc access now also requires the PARENT FOLDER's cap to permit the action (a root doc has
-- no folder, so the left join yields NULL → coalesce to 'editor' → no restriction). Owner bypasses both.
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
        or (
          coalesce(d.access_override, 'editor') in ('commenter', 'editor')
          and coalesce(f.access_override, 'editor') in ('commenter', 'editor')
        )
      )
  )
$$;

-- ---------- 4. Only the project OWNER may change a cap (folder + document) ----------
create or replace function public.protect_document_override()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.access_override is distinct from old.access_override
     and auth.uid() is not null
     and not public.is_project_owner(new.project_id) then
    raise exception 'Only the project owner can change a document''s permissions' using errcode = '42501';
  end if;
  return new;
end;
$$;
-- (trigger documents_protect_override from 0018 already calls this.)

create or replace function public.protect_folder_override()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.access_override is distinct from old.access_override
     and auth.uid() is not null
     and not public.is_project_owner(new.project_id) then
    raise exception 'Only the project owner can change a folder''s permissions' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists folders_protect_override on public.folders;
create trigger folders_protect_override
  before update on public.folders
  for each row execute function public.protect_folder_override();

-- ---------- 5. Policies: gate folder writes + doc creation on the folder cap ----------
drop policy if exists folders_update on public.folders;
create policy folders_update on public.folders for update
  using (public.can_edit_folder(id)) with check (public.can_edit_folder(id));
drop policy if exists folders_delete on public.folders;
create policy folders_delete on public.folders for delete
  using (public.can_edit_folder(id));

-- Creating a document requires project edit access AND, if it lands in a folder, that folder's cap to
-- permit editing — so a locked folder can't be populated by anyone but the owner.
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert
  with check (
    public.can_edit_project(project_id)
    and (folder_id is null or public.can_edit_folder(folder_id))
  );
