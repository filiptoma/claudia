-- 0023 — PRIVATE folders/documents (Discord private-channel model) for markdown projects.
-- Apply after 0001–0022 (single execution). REQUIRES 0021 (the `or p.type = 'latex'` short-circuit
-- in the cap helpers is preserved/re-applied here) and 0022 to be live first.
--
-- New, ORTHOGONAL to the downgrade cap (access_override, 0018/0020):
--   * access_override only LOWERS a tier; it never HIDES — anyone who can view the project reads it.
--   * is_private HIDES a folder/document from EVERYONE (the public, members, even project editors)
--     except the project owner and users with an explicit row in `resource_grants`.
-- On a private resource the effective tier comes from the GRANT role (viewer/commenter/editor), NOT
-- the project role or the access_override cap (privacy supersedes the cap). The owner is always exempt.
--
-- A document inside a PRIVATE folder inherits that folder's grantees; a document may also be
-- independently private inside a public folder. Granting pool: PUBLIC project -> any signed-in user;
-- PRIVATE project -> existing project members only (enforced in the grant-integrity trigger + redeem).
--
-- LaTeX is unchanged: resource-level privacy is markdown-only (the UI never sets is_private on a LaTeX
-- project) and the helpers below additionally short-circuit `type = 'latex'` to project-level as
-- defense-in-depth, mirroring 0021.
--
-- MEDIA: a private doc's images are scoped to the document by migration 0025 (paths become
-- `media/{project_id}/{document_id}/file` and media_select gates on can_view_document). Legacy 2-segment
-- images uploaded before 0025 stay project-scoped — see 0025's header for that residual limitation.

-- ============================================================================
-- 1. Privacy columns
-- ============================================================================
alter table public.folders   add column if not exists is_private boolean not null default false;
alter table public.documents add column if not exists is_private boolean not null default false;

-- ============================================================================
-- 2. resource_grants — per-resource membership for private folders/documents
-- ============================================================================
create table if not exists public.resource_grants (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id)  on delete cascade,  -- denormalized for RLS; forced by trigger
  folder_id   uuid          references public.folders (id)   on delete cascade,
  document_id uuid          references public.documents (id) on delete cascade,
  user_id     uuid not null references public.profiles (id)  on delete cascade,
  role        public.member_role not null default 'viewer',
  created_by  uuid          references public.profiles (id)  on delete set null,
  created_at  timestamptz not null default now(),
  -- exactly one of folder_id / document_id
  constraint resource_grants_target_ck
    check ((folder_id is not null)::int + (document_id is not null)::int = 1)
);

-- One grant per (folder, user) and per (document, user). Plain (non-partial) unique indexes: NULLs are
-- distinct in Postgres, so document-grant rows (folder_id NULL) never collide on the folder index and
-- vice-versa — each kind is deduped by its own index. Non-partial so PostgREST upsert + the bare
-- `on conflict (cols)` in redeem_invite can infer them (a partial index wouldn't be inferred).
create unique index if not exists resource_grants_folder_user_uk
  on public.resource_grants (folder_id, user_id);
create unique index if not exists resource_grants_document_user_uk
  on public.resource_grants (document_id, user_id);

-- lookup indexes (the view-helpers hit these on every folder/document read)
create index if not exists resource_grants_user_idx     on public.resource_grants (user_id);
create index if not exists resource_grants_project_idx  on public.resource_grants (project_id);

-- New table: the 0001 blanket grant does NOT cover it — grant explicitly. anon gets SELECT only (the app
-- loads this table app-wide, incl. for logged-out visitors; RLS still returns zero rows to anon), matching
-- the 0001 pattern for the original tables. Writes are authenticated-only and further gated by RLS.
grant select on public.resource_grants to anon;
grant select, insert, update, delete on public.resource_grants to authenticated;

alter table public.resource_grants enable row level security;

-- SELECT: the project owner (to manage) OR your own grant row (you may learn what you were granted,
-- but not who else has access). Gated only on is_project_owner (reads projects) → no recursion.
drop policy if exists rg_select on public.resource_grants;
create policy rg_select on public.resource_grants for select
  using (public.is_project_owner(project_id) or user_id = auth.uid());

-- Direct writes: project owner only. redeem_invite() inserts as SECURITY DEFINER and bypasses these,
-- so a grantee never needs direct insert rights.
drop policy if exists rg_insert on public.resource_grants;
create policy rg_insert on public.resource_grants for insert
  with check (public.is_project_owner(project_id));
drop policy if exists rg_update on public.resource_grants;
create policy rg_update on public.resource_grants for update
  using (public.is_project_owner(project_id)) with check (public.is_project_owner(project_id));
drop policy if exists rg_delete on public.resource_grants;
create policy rg_delete on public.resource_grants for delete
  using (public.is_project_owner(project_id));

-- Integrity: force project_id from the target's REAL project (defeats cross-project grant spoofing,
-- where an owner of A inserts project_id=A but document_id in B), AND enforce the granting pool rule
-- (private project => the grantee must already be a member or the owner). Mirrors set_comment_thread_project.
create or replace function public.set_resource_grant_project()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_is_public boolean;
begin
  if new.folder_id is not null then
    select project_id into v_pid from public.folders where id = new.folder_id;
  else
    select project_id into v_pid from public.documents where id = new.document_id;
  end if;
  if v_pid is null then raise exception 'grant target does not exist'; end if;
  new.project_id := v_pid;

  select is_public into v_is_public from public.projects where id = v_pid;
  if not v_is_public
     and not exists (select 1 from public.project_members m where m.project_id = v_pid and m.user_id = new.user_id)
     and not exists (select 1 from public.projects p where p.id = v_pid and p.owner = new.user_id) then
    raise exception 'On a private project, only existing project members can be granted resource access'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists resource_grants_set_project on public.resource_grants;
create trigger resource_grants_set_project before insert or update on public.resource_grants
  for each row execute function public.set_resource_grant_project();

-- ============================================================================
-- 3. Privacy-aware VIEW helpers (new). SECURITY DEFINER, read base tables directly → no RLS recursion.
--    Non-private resources reduce EXACTLY to can_view_project (today's behaviour, unchanged).
-- ============================================================================
create or replace function public.can_view_folder(p_folder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.folders f
    join public.projects p on p.id = f.project_id
    where f.id = p_folder
      and (
        p.owner = auth.uid()                                          -- owner always
        or (p.type = 'latex' and public.can_view_project(f.project_id))  -- latex: project-level (defense-in-depth)
        or (not f.is_private and public.can_view_project(f.project_id))  -- non-private: unchanged
        or (f.is_private and exists (                                  -- private: explicit folder grant
              select 1 from public.resource_grants g
              where g.folder_id = p_folder and g.user_id = auth.uid()
        ))
      )
  )
$$;
-- Used in the folders_select RLS policy, which ANON evaluates when reading a public project — so it must
-- be anon-executable (mirrors can_view_project). RLS still returns zero private rows to anon.
grant execute on function public.can_view_folder(uuid) to anon, authenticated;

create or replace function public.can_view_document(p_doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.documents d
    join public.projects p on p.id = d.project_id
    left join public.folders f on f.id = d.folder_id
    where d.id = p_doc
      and (
        p.owner = auth.uid()                                          -- owner always
        or (p.type = 'latex' and public.can_view_project(d.project_id))  -- latex: project-level
        or (
          case
            when d.is_private then                                     -- doc independently private
              exists (select 1 from public.resource_grants g
                      where g.document_id = p_doc and g.user_id = auth.uid())
            when coalesce(f.is_private, false) then                    -- inherits a private parent folder
              exists (select 1 from public.resource_grants g
                      where g.folder_id = d.folder_id and g.user_id = auth.uid())
              or exists (select 1 from public.resource_grants g
                      where g.document_id = p_doc and g.user_id = auth.uid())
            else
              public.can_view_project(d.project_id)                    -- non-private: unchanged
          end
        )
      )
  )
$$;
-- Used in documents_select + the four annotation SELECT policies, which ANON evaluates on public
-- projects — so it must be anon-executable (mirrors can_view_project). RLS still hides private rows.
grant execute on function public.can_view_document(uuid) to anon, authenticated;

-- User-scoped document visibility (for mention validation: "can THIS user see the doc?").
-- For a non-private doc on a PUBLIC project this returns true for any user (preserves 0017's
-- "mention anyone on a public project"); on a private project / private resource it is members/grantees only.
create or replace function public.can_user_view_document(p_doc uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.documents d
    join public.projects p on p.id = d.project_id
    left join public.folders f on f.id = d.folder_id
    where d.id = p_doc
      and (
        p.owner = p_user
        or p.type = 'latex' and (p.is_public or exists (
              select 1 from public.project_members m where m.project_id = p.id and m.user_id = p_user))
        or (
          case
            when d.is_private then
              exists (select 1 from public.resource_grants g where g.document_id = p_doc and g.user_id = p_user)
            when coalesce(f.is_private, false) then
              exists (select 1 from public.resource_grants g where g.folder_id = d.folder_id and g.user_id = p_user)
              or exists (select 1 from public.resource_grants g where g.document_id = p_doc and g.user_id = p_user)
            else
              p.is_public
              or exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = p_user)
          end
        )
      )
  )
$$;
revoke all on function public.can_user_view_document(uuid, uuid) from public, anon;
grant execute on function public.can_user_view_document(uuid, uuid) to authenticated;

-- ============================================================================
-- 4. Privacy-aware EDIT/COMMENT helpers (rewrite of 0018/0020/0021).
--    On a private resource the tier comes from the GRANT only (project role & access_override ignored).
--    Non-private branch is byte-for-byte today's logic; latex short-circuit preserved.
-- ============================================================================
create or replace function public.can_edit_folder(p_folder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.folders f
    join public.projects p on p.id = f.project_id
    where f.id = p_folder
      and (
        p.owner = auth.uid()
        or (p.type = 'latex' and public.can_edit_project(f.project_id))
        or (
          case
            when f.is_private then
              exists (select 1 from public.resource_grants g
                      where g.folder_id = p_folder and g.user_id = auth.uid() and g.role = 'editor')
            else
              public.can_edit_project(f.project_id)
              and coalesce(f.access_override, 'editor') = 'editor'
          end
        )
      )
  )
$$;

create or replace function public.can_edit_document(p_doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.documents d
    join public.projects p on p.id = d.project_id
    left join public.folders f on f.id = d.folder_id
    where d.id = p_doc
      and (
        p.owner = auth.uid()
        or (p.type = 'latex' and public.can_edit_project(d.project_id))
        or (
          case
            when d.is_private then
              exists (select 1 from public.resource_grants g
                      where g.document_id = p_doc and g.user_id = auth.uid() and g.role = 'editor')
            when coalesce(f.is_private, false) then
              exists (select 1 from public.resource_grants g
                      where g.folder_id = d.folder_id and g.user_id = auth.uid() and g.role = 'editor')
              or exists (select 1 from public.resource_grants g
                      where g.document_id = p_doc and g.user_id = auth.uid() and g.role = 'editor')
            else
              public.can_edit_project(d.project_id)
              and coalesce(d.access_override, 'editor') = 'editor'
              and coalesce(f.access_override, 'editor') = 'editor'
          end
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
      and (
        p.owner = auth.uid()
        or (p.type = 'latex' and public.can_comment_project(d.project_id))
        or (
          case
            when d.is_private then
              exists (select 1 from public.resource_grants g
                      where g.document_id = p_doc and g.user_id = auth.uid() and g.role in ('commenter','editor'))
            when coalesce(f.is_private, false) then
              exists (select 1 from public.resource_grants g
                      where g.folder_id = d.folder_id and g.user_id = auth.uid() and g.role in ('commenter','editor'))
              or exists (select 1 from public.resource_grants g
                      where g.document_id = p_doc and g.user_id = auth.uid() and g.role in ('commenter','editor'))
            else
              public.can_comment_project(d.project_id)
              and coalesce(d.access_override, 'editor') in ('commenter','editor')
              and coalesce(f.access_override, 'editor') in ('commenter','editor')
          end
        )
      )
  )
$$;

-- ============================================================================
-- 5. SELECT policies — hide private resources (and their annotations) from non-grantees.
--    Reduce to today's behaviour for non-private resources (can_view_document == can_view_project there).
-- ============================================================================
drop policy if exists folders_select on public.folders;
create policy folders_select on public.folders for select
  using (public.can_view_folder(id));

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select
  using (public.can_view_document(id));

drop policy if exists ct_select on public.comment_threads;
create policy ct_select on public.comment_threads for select
  using (public.can_view_document(document_id));

drop policy if exists c_select on public.comments;
create policy c_select on public.comments for select
  using (exists (select 1 from public.comment_threads t
                 where t.id = thread_id and public.can_view_document(t.document_id)));

drop policy if exists st_select on public.suggestion_threads;
create policy st_select on public.suggestion_threads for select
  using (public.can_view_document(document_id));

drop policy if exists sc_select on public.suggestion_comments;
create policy sc_select on public.suggestion_comments for select
  using (exists (select 1 from public.suggestion_threads s
                 where s.id = suggestion_id and public.can_view_document(s.document_id)));

-- ============================================================================
-- 6. The four list_document_* SECURITY DEFINER RPCs bypass RLS and gated on can_view_project — they
--    MUST move to can_view_document, or annotations on a private doc leak to non-grantees. Same return
--    types as 0011/0012/0015 (list_document_suggestions keeps the `status text` column) → create or replace.
-- ============================================================================
create or replace function public.list_document_comment_threads(p_document uuid)
returns table (
  id uuid, document_id uuid, project_id uuid,
  author uuid, author_name text, author_avatar_url text,
  anchor jsonb, source_start int, source_end int,
  resolved boolean, resolved_by uuid, resolver_name text, resolved_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select t.id, t.document_id, t.project_id,
         t.author, ap.name, ap.avatar_url,
         t.anchor, t.source_start, t.source_end,
         t.resolved, t.resolved_by, rp.name, t.resolved_at,
         t.created_at, t.updated_at
  from public.comment_threads t
  left join public.profiles ap on ap.id = t.author
  left join public.profiles rp on rp.id = t.resolved_by
  where t.document_id = p_document and public.can_view_document(t.document_id)
  order by t.created_at;
$$;

create or replace function public.list_document_comments(p_document uuid)
returns table (
  id uuid, thread_id uuid,
  author uuid, author_name text, author_avatar_url text,
  body text, mentions uuid[], created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.thread_id, c.author, ap.name, ap.avatar_url, c.body, c.mentions, c.created_at, c.updated_at
  from public.comments c
  join public.comment_threads t on t.id = c.thread_id
  left join public.profiles ap on ap.id = c.author
  where t.document_id = p_document and public.can_view_document(t.document_id)
  order by c.created_at;
$$;

create or replace function public.list_document_suggestions(p_document uuid)
returns table (
  id uuid, document_id uuid, project_id uuid,
  author uuid, author_name text, author_avatar_url text,
  anchor jsonb, source_start int, source_end int,
  original_md text, suggested_md text, status text, created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, s.document_id, s.project_id,
         s.author, ap.name, ap.avatar_url,
         s.anchor, s.source_start, s.source_end,
         s.original_md, s.suggested_md, s.status, s.created_at, s.updated_at
  from public.suggestion_threads s
  left join public.profiles ap on ap.id = s.author
  where s.document_id = p_document and public.can_view_document(s.document_id)
  order by s.created_at;
$$;

create or replace function public.list_document_suggestion_comments(p_document uuid)
returns table (
  id uuid, suggestion_id uuid,
  author uuid, author_name text, author_avatar_url text,
  body text, mentions uuid[], created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.suggestion_id, c.author, ap.name, ap.avatar_url, c.body, c.mentions, c.created_at, c.updated_at
  from public.suggestion_comments c
  join public.suggestion_threads s on s.id = c.suggestion_id
  left join public.profiles ap on ap.id = c.author
  where s.document_id = p_document and public.can_view_document(s.document_id)
  order by c.created_at;
$$;

-- ============================================================================
-- 7. Mentions — enforce that a mention target can actually VIEW the (possibly private) document.
--    The validation triggers are the enforced boundary; routing them through can_user_view_document
--    closes the "mention/notify a non-grantee about a private doc" path while preserving 0017's
--    "mention anyone on a public project" for non-private docs. (The candidate pickers remain
--    project-scoped — they may over-suggest on a public project's private doc, but the insert is blocked.)
-- ============================================================================
create or replace function public.validate_comment_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare did uuid; uid uuid;
begin
  select document_id into did from public.comment_threads where id = new.thread_id;
  foreach uid in array new.mentions loop
    if not public.can_user_view_document(did, uid) then
      raise exception 'mention target % cannot access this document', uid using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.validate_suggestion_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare did uuid; uid uuid;
begin
  select document_id into did from public.suggestion_threads where id = new.suggestion_id;
  foreach uid in array new.mentions loop
    if not public.can_user_view_document(did, uid) then
      raise exception 'mention target % cannot access this document', uid using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

-- ============================================================================
-- 8. WRITE policies + protect triggers
-- ============================================================================
-- documents_insert: make the resource helpers authoritative so a PRIVATE-FOLDER editor-grantee (who may
-- be only a project viewer) can create docs in it. Creating an already-private doc is owner-only.
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert
  with check (
    case
      when folder_id is not null then public.can_edit_folder(folder_id)
      else public.can_edit_project(project_id)
    end
    and (not is_private or public.is_project_owner(project_id))
  );

-- folders_update/delete and documents_update/delete keep their 0018/0020 shape — the now privacy-aware
-- helpers do the work — but re-assert them here for clarity and idempotency.
drop policy if exists folders_update on public.folders;
create policy folders_update on public.folders for update
  using (public.can_edit_folder(id)) with check (public.can_edit_folder(id));
drop policy if exists folders_delete on public.folders;
create policy folders_delete on public.folders for delete
  using (public.can_edit_folder(id));

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
  using (public.can_edit_document(id)) with check (public.can_edit_document(id));
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (public.can_edit_document(id));

-- Only the project OWNER may flip is_private (mirror protect_*_override). Service role / direct SQL
-- (auth.uid() is null) is exempt for admin/bootstrap, as elsewhere.
create or replace function public.protect_folder_privacy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_private is distinct from old.is_private
     and auth.uid() is not null
     and not public.is_project_owner(new.project_id) then
    raise exception 'Only the project owner can change a folder''s privacy' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists folders_protect_privacy on public.folders;
create trigger folders_protect_privacy before update on public.folders
  for each row execute function public.protect_folder_privacy();

create or replace function public.protect_document_privacy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_private is distinct from old.is_private
     and auth.uid() is not null
     and not public.is_project_owner(new.project_id) then
    raise exception 'Only the project owner can change a document''s privacy' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists documents_protect_privacy on public.documents;
create trigger documents_protect_privacy before update on public.documents
  for each row execute function public.protect_document_privacy();

-- A non-owner must not move a document INTO or OUT OF a private folder (would exfiltrate it from, or
-- smuggle it into, a private space). The owner moves freely; non-private<->non-private moves are unaffected.
create or replace function public.protect_document_move()
returns trigger language plpgsql security definer set search_path = public as $$
declare old_priv boolean := false; new_priv boolean := false;
begin
  if new.folder_id is distinct from old.folder_id
     and auth.uid() is not null
     and not public.is_project_owner(new.project_id) then
    if old.folder_id is not null then
      select is_private into old_priv from public.folders where id = old.folder_id;
    end if;
    if new.folder_id is not null then
      select is_private into new_priv from public.folders where id = new.folder_id;
    end if;
    if coalesce(old_priv, false) or coalesce(new_priv, false) then
      raise exception 'Only the project owner can move documents in or out of a private folder'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists documents_protect_move on public.documents;
create trigger documents_protect_move before update on public.documents
  for each row execute function public.protect_document_move();

-- ============================================================================
-- 9. list_resource_grants — management RPC for the owner's Access panel (joins profile display info,
--    which RLS would otherwise hide). Gated on is_project_owner of the resource's project. Pass exactly
--    one of p_folder / p_document.
-- ============================================================================
create or replace function public.list_resource_grants(p_folder uuid, p_document uuid)
returns table (user_id uuid, name text, email text, avatar_url text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.user_id, pr.name, pr.email, pr.avatar_url, g.role::text, g.created_at
  from public.resource_grants g
  join public.profiles pr on pr.id = g.user_id
  where ((p_folder is not null and g.folder_id = p_folder)
      or (p_document is not null and g.document_id = p_document))
    and public.is_project_owner(g.project_id)        -- gate: non-owner -> no rows
  order by pr.name nulls last, pr.email;
$$;
revoke all on function public.list_resource_grants(uuid, uuid) from public, anon;
grant execute on function public.list_resource_grants(uuid, uuid) to authenticated;
