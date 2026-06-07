-- 0018 — per-document permission override (a "lock" the owner sets on a single document).
-- Apply after 0001–0017 (single execution; no enum changes here). Fail-closed throughout.
--
-- Use case: a project editor/commenter can act across the whole project, but the owner wants ONE
-- document restricted (e.g. "view only" for everyone else). `documents.access_override` caps the
-- effective tier for that document for EVERYONE EXCEPT the project owner — it can only restrict, never
-- elevate (so it never grants access the project role doesn't already give).
--
--   access_override = NULL        → inherit the project permission (today's behaviour; the default)
--   access_override = 'commenter' → non-owners may at most comment/suggest (no direct editing)
--   access_override = 'viewer'    → non-owners may only read (no commenting, no suggesting, no editing)
--   access_override = 'editor'    → no-op cap (editor is already the project ceiling) — accepted but
--                                   never surfaced in the UI
--
-- The owner is always exempt: they can edit and lock/unlock their own document. Only project managers
-- (owner, or admin on a public project — see can_manage_project) may CHANGE the override (trigger below).

-- ---------- 1. The override column ----------
alter table public.documents
  add column if not exists access_override public.member_role;

-- ---------- 2. Document-level access helpers ----------
-- Effective edit access on a single document = project edit access AND the per-doc cap permits editing
-- (owner bypasses the cap). SECURITY DEFINER so the internal reads bypass RLS (no recursion with the
-- documents policies, which call this).
create or replace function public.can_edit_document(p_doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.documents d
    join public.projects p on p.id = d.project_id
    where d.id = p_doc
      and public.can_edit_project(d.project_id)
      and (
        p.owner = auth.uid()                                -- owner is exempt from the per-doc cap
        or coalesce(d.access_override, 'editor') = 'editor' -- cap must still permit editing
      )
  )
$$;
revoke all on function public.can_edit_document(uuid) from public, anon;
grant execute on function public.can_edit_document(uuid) to authenticated;

-- Effective comment/suggest access on a single document = project comment access AND the per-doc cap
-- permits commenting (owner bypasses the cap).
create or replace function public.can_comment_document(p_doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.documents d
    join public.projects p on p.id = d.project_id
    where d.id = p_doc
      and public.can_comment_project(d.project_id)
      and (
        p.owner = auth.uid()
        or coalesce(d.access_override, 'editor') in ('commenter', 'editor')
      )
  )
$$;
revoke all on function public.can_comment_document(uuid) from public, anon;
grant execute on function public.can_comment_document(uuid) to authenticated;

-- ---------- 3. Only managers may change the override ----------
-- documents_update (below) lets any project editor PATCH a document's content — but flipping the lock
-- itself is a manage action. Block override changes by non-managers (direct SQL / service role bypass:
-- auth.uid() is null, for admin bootstrap & data clones), mirroring protect_profile_role.
create or replace function public.protect_document_override()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.access_override is distinct from old.access_override
     and auth.uid() is not null
     and not public.can_manage_project(new.project_id) then
    raise exception 'Only the project owner can change a document''s permissions' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists documents_protect_override on public.documents;
create trigger documents_protect_override
  before update on public.documents
  for each row execute function public.protect_document_override();

-- ---------- 4. documents: gate edits/deletes on the document-level helper ----------
-- (INSERT stays project-level: a brand-new document has no override yet.)
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
  using (public.can_edit_document(id)) with check (public.can_edit_document(id));
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (public.can_edit_document(id));

-- ---------- 5. Annotations: respect the per-doc cap ----------
-- Create/reply/moderate now gate on the document-level helpers; SELECT (reading existing annotations)
-- stays can_view_project — a view-only cap still lets people read the conversation.
drop policy if exists ct_insert on public.comment_threads;
create policy ct_insert on public.comment_threads for insert
  with check (public.can_comment_document(document_id) and author = auth.uid());

drop policy if exists ct_update on public.comment_threads;
create policy ct_update on public.comment_threads for update
  using (author = auth.uid() or public.can_edit_document(document_id))
  with check (author = auth.uid() or public.can_edit_document(document_id));   -- resolve = update

drop policy if exists ct_delete on public.comment_threads;
create policy ct_delete on public.comment_threads for delete
  using (author = auth.uid() or (public.can_edit_document(document_id) and resolved));

drop policy if exists c_insert on public.comments;
create policy c_insert on public.comments for insert
  with check (author = auth.uid()
    and exists (select 1 from public.comment_threads t
                where t.id = thread_id and public.can_comment_document(t.document_id)));

drop policy if exists c_delete on public.comments;
create policy c_delete on public.comments for delete
  using (author = auth.uid()
    or exists (select 1 from public.comment_threads t
               where t.id = thread_id and public.can_edit_document(t.document_id)));

drop policy if exists st_insert on public.suggestion_threads;
create policy st_insert on public.suggestion_threads for insert
  with check (public.can_comment_document(document_id) and author = auth.uid());

drop policy if exists st_delete on public.suggestion_threads;
create policy st_delete on public.suggestion_threads for delete
  using ((author = auth.uid() and status = 'pending')
      or (public.can_edit_document(document_id) and status <> 'pending'));

drop policy if exists sc_insert on public.suggestion_comments;
create policy sc_insert on public.suggestion_comments for insert
  with check (author = auth.uid()
    and exists (select 1 from public.suggestion_threads s
                where s.id = suggestion_id and public.can_comment_document(s.document_id)));

drop policy if exists sc_delete on public.suggestion_comments;
create policy sc_delete on public.suggestion_comments for delete
  using (author = auth.uid()
    or exists (select 1 from public.suggestion_threads s
               where s.id = suggestion_id and public.can_edit_document(s.document_id)));

-- ---------- 6. RPCs: gate on the document-level helpers ----------
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
  if not public.can_comment_document(p_document) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'comment body required'; end if;
  insert into public.comment_threads (document_id, project_id, author, anchor, source_start, source_end)
    values (p_document, pid, auth.uid(), p_anchor, p_source_start, p_source_end)
    returning id into tid;
  insert into public.comments (thread_id, author, body, mentions)
    values (tid, auth.uid(), p_body, coalesce(p_mentions, '{}'));
  return tid;
end;
$$;

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
  if not public.can_comment_document(p_document) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.suggestion_threads
    (document_id, project_id, author, anchor, source_start, source_end, original_md, suggested_md)
    values (p_document, pid, auth.uid(), p_anchor, p_source_start, p_source_end, p_original_md, p_suggested_md)
    returning id into sid;
  if coalesce(btrim(p_note), '') <> '' then
    insert into public.suggestion_comments (suggestion_id, author, body, mentions)
      values (sid, auth.uid(), p_note, coalesce(p_mentions, '{}'));
  end if;
  return sid;
end;
$$;

-- Approve: applying a suggestion edits content, so it requires document-level edit access (owner, or a
-- project editor on a doc that isn't capped below 'editor').
create or replace function public.apply_suggestion(p_suggestion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.suggestion_threads; cur text;
begin
  select * into s from public.suggestion_threads where id = p_suggestion;
  if not found then raise exception 'suggestion not found'; end if;
  if not public.can_edit_document(s.document_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if s.status <> 'pending' then raise exception 'suggestion already resolved'; end if;
  select content into cur from public.documents where id = s.document_id;
  if substr(cur, s.source_start + 1, s.source_end - s.source_start) is distinct from s.original_md then
    raise exception 'stale: the document text changed since this suggestion was made';
  end if;
  update public.documents
     set content = left(cur, s.source_start) || s.suggested_md || substr(cur, s.source_end + 1)
   where id = s.document_id;
  update public.suggestion_threads set status = 'accepted' where id = p_suggestion;
end;
$$;

create or replace function public.reject_suggestion(p_suggestion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.suggestion_threads;
begin
  select * into s from public.suggestion_threads where id = p_suggestion;
  if not found then raise exception 'suggestion not found'; end if;
  if not public.can_edit_document(s.document_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if s.status <> 'pending' then raise exception 'suggestion already resolved'; end if;
  update public.suggestion_threads set status = 'rejected' where id = p_suggestion;
end;
$$;
