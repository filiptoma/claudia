-- 0009 — inline comments (Google-Docs style): threads anchored to a text range in a document,
-- with replies, resolve/unresolve, and @mentions. Apply to both dev and prod after 0001–0008.
--
-- Access model (mirrors documents/folders, which inherit project access):
--   read   = can_view_project  (anyone who can view the doc can read comments)
--   create = can_view_project AND author = self  (viewers may comment)
--   resolve/update/delete a thread = thread author OR can_edit_project (editor/owner/staff)
--   edit a message = its author;  delete a message = its author OR can_edit_project
-- profiles stays private (RLS), so author/resolver display info and the @mention candidate list
-- are exposed only through the SECURITY DEFINER RPCs at the bottom, each gated by project access.

-- ---------- tables ----------
create table public.comment_threads (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,  -- denormalized for RLS
  author       uuid references public.profiles (id) on delete set null,
  anchor       jsonb not null,            -- { quote, prefix, suffix } — fuzzy re-anchor + display
  source_start int not null,              -- exact offset into documents.content (primary anchor)
  source_end   int not null,
  resolved     boolean not null default false,
  resolved_by  uuid references public.profiles (id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint comment_threads_range_ck check (source_end >= source_start)
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.comment_threads (id) on delete cascade,
  author     uuid references public.profiles (id) on delete set null,
  body       text not null check (char_length(body) <= 10000),
  mentions   uuid[] not null default '{}',  -- validated to project-accessible users (trigger below)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.comment_threads (document_id);
create index on public.comment_threads (project_id);
create index on public.comments (thread_id);

-- ---------- helpers ----------
-- Is this user allowed to be @mentioned in this project? (owner or any member.) SECURITY DEFINER so
-- it can see project_members/projects regardless of the caller's RLS.
create or replace function public.is_mentionable(p_project uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p where p.id = p_project and p.owner = p_user)
      or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = p_user);
$$;

-- ---------- triggers ----------
-- Integrity: project_id is ALWAYS the document's real project, never trusted from the client. Runs
-- before the RLS WITH CHECK, so the check validates access against the true project. A missing/unknown
-- document yields NULL -> can_view_project(NULL) is false -> insert denied (fail closed).
create or replace function public.set_comment_thread_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.project_id := (select project_id from public.documents where id = new.document_id);
  return new;
end;
$$;
create trigger comment_threads_set_project before insert on public.comment_threads
  for each row execute function public.set_comment_thread_project();

-- Fail-closed mention validation: every uuid in mentions must have access to the thread's project.
create or replace function public.validate_comment_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid; uid uuid;
begin
  select project_id into pid from public.comment_threads where id = new.thread_id;
  foreach uid in array new.mentions loop
    if not public.is_mentionable(pid, uid) then
      raise exception 'mention target % is not a member of this project', uid using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
create trigger comments_validate_mentions before insert or update on public.comments
  for each row execute function public.validate_comment_mentions();

create trigger comment_threads_updated before update on public.comment_threads
  for each row execute function public.set_updated_at();
create trigger comments_updated before update on public.comments
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.comment_threads enable row level security;
alter table public.comments        enable row level security;

-- threads
create policy ct_select on public.comment_threads for select
  using (public.can_view_project(project_id));
create policy ct_insert on public.comment_threads for insert
  with check (public.can_view_project(project_id) and author = auth.uid());
create policy ct_update on public.comment_threads for update
  using (author = auth.uid() or public.can_edit_project(project_id))
  with check (author = auth.uid() or public.can_edit_project(project_id));   -- resolve = update
create policy ct_delete on public.comment_threads for delete
  using (author = auth.uid() or public.can_edit_project(project_id));

-- messages
create policy c_select on public.comments for select
  using (exists (select 1 from public.comment_threads t
                 where t.id = thread_id and public.can_view_project(t.project_id)));
create policy c_insert on public.comments for insert
  with check (author = auth.uid()
    and exists (select 1 from public.comment_threads t
                where t.id = thread_id and public.can_view_project(t.project_id)));
create policy c_update on public.comments for update
  using (author = auth.uid()) with check (author = auth.uid());
create policy c_delete on public.comments for delete
  using (author = auth.uid()
    or exists (select 1 from public.comment_threads t
               where t.id = thread_id and public.can_edit_project(t.project_id)));

-- ---------- RPCs (profiles is private; these expose only what project access allows) ----------

-- @mention candidates: owner + members of a project. Callable by anyone with view access.
create or replace function public.list_mentionable_users(p_project uuid)
returns table (id uuid, name text, email text, avatar_url text, member_role text)
language sql stable security definer set search_path = public as $$
  select x.id, pr.name, pr.email, pr.avatar_url, x.member_role
  from (
    select p.owner as id, 'owner' as member_role, 0 as ord
      from public.projects p where p.id = p_project and p.owner is not null
    union
    select m.user_id, m.role::text, 1 from public.project_members m where m.project_id = p_project
  ) x
  join public.profiles pr on pr.id = x.id
  where public.can_view_project(p_project)        -- gate: no access -> no rows
  order by x.ord, pr.name nulls last, pr.email;
$$;

-- Create a thread + its first message atomically. project_id is derived from the document.
create or replace function public.create_comment_thread(
  p_document uuid, p_anchor jsonb, p_source_start int, p_source_end int,
  p_body text, p_mentions uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; tid uuid;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select project_id into pid from public.documents where id = p_document;
  if pid is null then raise exception 'document not found'; end if;
  if not public.can_view_project(pid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'comment body required'; end if;

  insert into public.comment_threads (document_id, project_id, author, anchor, source_start, source_end)
    values (p_document, pid, auth.uid(), p_anchor, p_source_start, p_source_end)
    returning id into tid;
  insert into public.comments (thread_id, author, body, mentions)
    values (tid, auth.uid(), p_body, coalesce(p_mentions, '{}'));  -- mention trigger validates
  return tid;
end;
$$;

-- All threads of a document with author + resolver display info. Gated by project view access.
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
  where t.document_id = p_document and public.can_view_project(t.project_id)
  order by t.created_at;
$$;

-- All messages across a document's threads with author display info. Gated by project view access.
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
  where t.document_id = p_document and public.can_view_project(t.project_id)
  order by c.created_at;
$$;

-- Lock down grants (these read profiles, so never expose to anon).
revoke all on function public.list_mentionable_users(uuid)        from public, anon;
revoke all on function public.create_comment_thread(uuid, jsonb, int, int, text, uuid[]) from public, anon;
revoke all on function public.list_document_comment_threads(uuid) from public, anon;
revoke all on function public.list_document_comments(uuid)        from public, anon;
grant execute on function public.list_mentionable_users(uuid)        to authenticated;
grant execute on function public.create_comment_thread(uuid, jsonb, int, int, text, uuid[]) to authenticated;
grant execute on function public.list_document_comment_threads(uuid) to authenticated;
grant execute on function public.list_document_comments(uuid)        to authenticated;
