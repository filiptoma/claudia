-- 0010 — suggested edits (Google-Docs style): a reader proposes replacing a text range with new
-- markdown; an editor/owner approves (the document is updated) or rejects. Either way the suggestion
-- row is DELETED immediately (replies cascade). @mentions supported. Apply after 0001–0009.
--
-- Access model:
--   read   = can_view_project
--   create = can_view_project AND author = self  (this is the whole point: viewers without edit
--            access can still propose changes)
--   update a suggestion = its author only (tweak own pending proposal)
--   delete = author (withdraw) OR can_edit_project (reject)
--   approve (apply + delete) = can_edit_project, via the apply_suggestion() RPC (atomic, stale-safe)

-- ---------- tables ----------
create table public.suggestion_threads (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,  -- denormalized for RLS
  author       uuid references public.profiles (id) on delete set null,
  anchor       jsonb not null,            -- { quote, prefix, suffix }
  source_start int not null,              -- exact offsets into documents.content at creation
  source_end   int not null,
  original_md  text not null,             -- content.slice(start,end) snapshot for stale detection
  suggested_md text not null check (char_length(suggested_md) <= 100000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint suggestion_threads_range_ck check (source_end >= source_start)
  -- NOTE: no status column. Existence == pending; the row is deleted on approve/reject.
);

create table public.suggestion_comments (
  id            uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.suggestion_threads (id) on delete cascade,
  author        uuid references public.profiles (id) on delete set null,
  body          text not null check (char_length(body) <= 10000),
  mentions      uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.suggestion_threads (document_id);
create index on public.suggestion_threads (project_id);
create index on public.suggestion_comments (suggestion_id);

-- ---------- triggers ----------
-- project_id always derived from the document (never trusted from the client); runs before RLS check.
create or replace function public.set_suggestion_thread_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.project_id := (select project_id from public.documents where id = new.document_id);
  return new;
end;
$$;
create trigger suggestion_threads_set_project before insert on public.suggestion_threads
  for each row execute function public.set_suggestion_thread_project();

-- Fail-closed mention validation against the suggestion's project (reuses is_mentionable from 0009).
create or replace function public.validate_suggestion_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid; uid uuid;
begin
  select project_id into pid from public.suggestion_threads where id = new.suggestion_id;
  foreach uid in array new.mentions loop
    if not public.is_mentionable(pid, uid) then
      raise exception 'mention target % is not a member of this project', uid using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
create trigger suggestion_comments_validate_mentions before insert or update on public.suggestion_comments
  for each row execute function public.validate_suggestion_mentions();

create trigger suggestion_threads_updated before update on public.suggestion_threads
  for each row execute function public.set_updated_at();
create trigger suggestion_comments_updated before update on public.suggestion_comments
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.suggestion_threads  enable row level security;
alter table public.suggestion_comments enable row level security;

create policy st_select on public.suggestion_threads for select
  using (public.can_view_project(project_id));
create policy st_insert on public.suggestion_threads for insert
  with check (public.can_view_project(project_id) and author = auth.uid());
create policy st_update on public.suggestion_threads for update
  using (author = auth.uid()) with check (author = auth.uid());
create policy st_delete on public.suggestion_threads for delete
  using (author = auth.uid() or public.can_edit_project(project_id));  -- withdraw OR reject

create policy sc_select on public.suggestion_comments for select
  using (exists (select 1 from public.suggestion_threads s
                 where s.id = suggestion_id and public.can_view_project(s.project_id)));
create policy sc_insert on public.suggestion_comments for insert
  with check (author = auth.uid()
    and exists (select 1 from public.suggestion_threads s
                where s.id = suggestion_id and public.can_view_project(s.project_id)));
create policy sc_update on public.suggestion_comments for update
  using (author = auth.uid()) with check (author = auth.uid());
create policy sc_delete on public.suggestion_comments for delete
  using (author = auth.uid()
    or exists (select 1 from public.suggestion_threads s
               where s.id = suggestion_id and public.can_edit_project(s.project_id)));

-- ---------- RPCs ----------

-- Create a suggestion (+ optional opening note) atomically. project_id derived from the document.
create or replace function public.create_suggestion(
  p_document uuid, p_anchor jsonb, p_source_start int, p_source_end int,
  p_original_md text, p_suggested_md text, p_note text, p_mentions uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; sid uuid;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select project_id into pid from public.documents where id = p_document;
  if pid is null then raise exception 'document not found'; end if;
  if not public.can_view_project(pid) then raise exception 'forbidden' using errcode = '42501'; end if;

  insert into public.suggestion_threads
    (document_id, project_id, author, anchor, source_start, source_end, original_md, suggested_md)
    values (p_document, pid, auth.uid(), p_anchor, p_source_start, p_source_end, p_original_md, p_suggested_md)
    returning id into sid;
  if coalesce(btrim(p_note), '') <> '' then
    insert into public.suggestion_comments (suggestion_id, author, body, mentions)
      values (sid, auth.uid(), p_note, coalesce(p_mentions, '{}'));  -- mention trigger validates
  end if;
  return sid;
end;
$$;

-- Approve: atomic, server-validated apply-then-delete. SECURITY DEFINER, but re-checks edit access
-- and that the anchored source is unchanged (stale-safe), so a concurrent edit can't be clobbered.
create or replace function public.apply_suggestion(p_suggestion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.suggestion_threads; cur text;
begin
  select * into s from public.suggestion_threads where id = p_suggestion;
  if not found then raise exception 'suggestion not found'; end if;
  if not public.can_edit_project(s.project_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select content into cur from public.documents where id = s.document_id;
  -- substr is 1-indexed; source_start is a 0-based JS offset.
  if substr(cur, s.source_start + 1, s.source_end - s.source_start) is distinct from s.original_md then
    raise exception 'stale: the document text changed since this suggestion was made';
  end if;

  update public.documents
     set content = left(cur, s.source_start) || s.suggested_md || substr(cur, s.source_end + 1)
   where id = s.document_id;                       -- documents RLS still enforces can_edit
  delete from public.suggestion_threads where id = p_suggestion;  -- cascade-deletes its replies
end;
$$;

-- All suggestions of a document with author display info. Gated by project view access.
create or replace function public.list_document_suggestions(p_document uuid)
returns table (
  id uuid, document_id uuid, project_id uuid,
  author uuid, author_name text, author_avatar_url text,
  anchor jsonb, source_start int, source_end int,
  original_md text, suggested_md text, created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, s.document_id, s.project_id,
         s.author, ap.name, ap.avatar_url,
         s.anchor, s.source_start, s.source_end,
         s.original_md, s.suggested_md, s.created_at, s.updated_at
  from public.suggestion_threads s
  left join public.profiles ap on ap.id = s.author
  where s.document_id = p_document and public.can_view_project(s.project_id)
  order by s.created_at;
$$;

-- All replies across a document's suggestions with author display info.
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
  where s.document_id = p_document and public.can_view_project(s.project_id)
  order by c.created_at;
$$;

-- Lock down grants.
revoke all on function public.create_suggestion(uuid, jsonb, int, int, text, text, text, uuid[]) from public, anon;
revoke all on function public.apply_suggestion(uuid)                       from public, anon;
revoke all on function public.list_document_suggestions(uuid)              from public, anon;
revoke all on function public.list_document_suggestion_comments(uuid)      from public, anon;
grant execute on function public.create_suggestion(uuid, jsonb, int, int, text, text, text, uuid[]) to authenticated;
grant execute on function public.apply_suggestion(uuid)                       to authenticated;
grant execute on function public.list_document_suggestions(uuid)              to authenticated;
grant execute on function public.list_document_suggestion_comments(uuid)      to authenticated;
