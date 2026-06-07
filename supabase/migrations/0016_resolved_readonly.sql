-- 0016 — resolved threads are read-only. Once a comment is resolved (or a suggestion accepted/
-- rejected) it accepts no new replies and no edits to its messages — only deletion. Apply after 0015.

-- Comments: a reply may be added only by a commenter on a still-OPEN thread.
drop policy if exists c_insert on public.comments;
create policy c_insert on public.comments for insert
  with check (
    author = auth.uid()
    and exists (
      select 1 from public.comment_threads t
      where t.id = thread_id and public.can_comment_project(t.project_id) and not t.resolved
    )
  );

-- Comments: a message body may be edited by its author only while its thread is open.
drop policy if exists c_update on public.comments;
create policy c_update on public.comments for update
  using (
    author = auth.uid()
    and exists (select 1 from public.comment_threads t where t.id = thread_id and not t.resolved)
  )
  with check (
    author = auth.uid()
    and exists (select 1 from public.comment_threads t where t.id = thread_id and not t.resolved)
  );

-- Suggestion replies: only by a commenter on a still-PENDING suggestion.
drop policy if exists sc_insert on public.suggestion_comments;
create policy sc_insert on public.suggestion_comments for insert
  with check (
    author = auth.uid()
    and exists (
      select 1 from public.suggestion_threads s
      where s.id = suggestion_id and public.can_comment_project(s.project_id) and s.status = 'pending'
    )
  );

-- Suggestion reply edits: by the author only while the suggestion is still pending.
drop policy if exists sc_update on public.suggestion_comments;
create policy sc_update on public.suggestion_comments for update
  using (
    author = auth.uid()
    and exists (select 1 from public.suggestion_threads s where s.id = suggestion_id and s.status = 'pending')
  )
  with check (
    author = auth.uid()
    and exists (select 1 from public.suggestion_threads s where s.id = suggestion_id and s.status = 'pending')
  );
