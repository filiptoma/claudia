-- 0032 — Reap an orphaned comment thread / suggestion (its anchored text was removed from the document).
--
-- When an editor deletes (or rewrites) the exact text a comment/suggestion was anchored to, the
-- annotation has no referent left, so the client deletes it. The existing per-table delete RLS is too
-- narrow for this (ct_delete: author OR editor-only-if-resolved; st_delete: author-if-pending OR
-- editor-if-resolved), so an editor can't remove someone ELSE's unresolved comment / pending suggestion
-- whose anchor they just deleted. This SECURITY DEFINER RPC closes that gap with a single gate:
-- can_edit_document — i.e. exactly the people who can change the text that orphans an anchor.
--
-- Orphan detection is necessarily client-side (it depends on re-resolving the quote/prefix/suffix anchor
-- against the *rendered* document, which the DB can't reproduce — and during live editing the client's
-- text is ahead of the saved content), so the server trusts the editor's call. That trust is bounded:
-- an editor already controls the document body and can destroy any anchor at will, so letting them delete
-- the now-danling annotation grants no new power. Idempotent: a no-op if the row is already gone.
--
-- Apply after 0031 (via the dashboard SQL editor — no local Supabase here).

create or replace function public.reap_orphaned_annotation(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_doc uuid;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;

  if p_kind = 'comment' then
    select document_id into v_doc from public.comment_threads where id = p_id;
    if v_doc is null then return; end if;  -- already deleted; nothing to do
    if not public.can_edit_document(v_doc) then raise exception 'forbidden' using errcode = '42501'; end if;
    delete from public.comment_threads where id = p_id;     -- cascade-deletes its replies
  elsif p_kind = 'suggestion' then
    select document_id into v_doc from public.suggestion_threads where id = p_id;
    if v_doc is null then return; end if;
    if not public.can_edit_document(v_doc) then raise exception 'forbidden' using errcode = '42501'; end if;
    delete from public.suggestion_threads where id = p_id;  -- cascade-deletes its replies
  else
    raise exception 'invalid annotation kind: %', p_kind;
  end if;
end;
$$;
revoke all on function public.reap_orphaned_annotation(text, uuid) from public, anon;
grant execute on function public.reap_orphaned_annotation(text, uuid) to authenticated;
