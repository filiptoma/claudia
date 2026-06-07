-- 0015 — annotation lifecycle: table grants, suggestion status, resolve-before-delete.
-- Apply after 0001–0014 (single execution is fine; no enum changes here).

-- ---------- 1. Table grants ----------
-- 0001's `grant ... on all tables` only covered tables that existed then; the annotation tables
-- (0011/0012) were created later and never granted, so direct writes (reply, resolve, delete) hit
-- "permission denied for table …". RLS still governs which rows each user may touch.
grant select, insert, update, delete on public.comment_threads     to authenticated;
grant select, insert, update, delete on public.comments            to authenticated;
grant select, insert, update, delete on public.suggestion_threads  to authenticated;
grant select, insert, update, delete on public.suggestion_comments to authenticated;

-- ---------- 2. Suggestion lifecycle status ----------
-- Existence is no longer "pending": approve/reject keep the row (status accepted/rejected) so it can
-- be reviewed and then deleted as cleanup, mirroring how resolved comments behave.
alter table public.suggestion_threads
  add column if not exists status text not null default 'pending'
  check (status in ('pending', 'accepted', 'rejected'));

-- ---------- 3. Resolve/accept/reject-before-delete policies ----------
-- Comments: the author may withdraw their own; editors/owners may delete only once it's resolved.
drop policy if exists ct_delete on public.comment_threads;
create policy ct_delete on public.comment_threads for delete
  using (author = auth.uid() or (public.can_edit_project(project_id) and resolved));

-- Suggestions: the author may withdraw their own *pending* one; editors/owners delete only resolved.
drop policy if exists st_delete on public.suggestion_threads;
create policy st_delete on public.suggestion_threads for delete
  using ((author = auth.uid() and status = 'pending')
      or (public.can_edit_project(project_id) and status <> 'pending'));

-- The author may only tweak (edit) their own suggestion while it's still pending.
drop policy if exists st_update on public.suggestion_threads;
create policy st_update on public.suggestion_threads for update
  using (author = auth.uid() and status = 'pending')
  with check (author = auth.uid() and status = 'pending');

-- ---------- 4. Approve: apply to content + mark accepted (keep the row) ----------
-- Editor-only, stale-safe, idempotent. (definer bypasses RLS; the can_edit check is the gate.)
create or replace function public.apply_suggestion(p_suggestion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.suggestion_threads; cur text;
begin
  select * into s from public.suggestion_threads where id = p_suggestion;
  if not found then raise exception 'suggestion not found'; end if;
  if not public.can_edit_project(s.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
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

-- ---------- 5. Reject: editor-only; mark rejected (keep the row) ----------
create or replace function public.reject_suggestion(p_suggestion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.suggestion_threads;
begin
  select * into s from public.suggestion_threads where id = p_suggestion;
  if not found then raise exception 'suggestion not found'; end if;
  if not public.can_edit_project(s.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if s.status <> 'pending' then raise exception 'suggestion already resolved'; end if;
  update public.suggestion_threads set status = 'rejected' where id = p_suggestion;
end;
$$;
revoke all on function public.reject_suggestion(uuid) from public, anon;
grant execute on function public.reject_suggestion(uuid) to authenticated;

-- ---------- 6. Surface status in the listing (return-type change → drop + recreate) ----------
drop function if exists public.list_document_suggestions(uuid);
create function public.list_document_suggestions(p_document uuid)
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
  where s.document_id = p_document and public.can_view_project(s.project_id)
  order by s.created_at;
$$;
revoke all on function public.list_document_suggestions(uuid) from public, anon;
grant execute on function public.list_document_suggestions(uuid) to authenticated;
