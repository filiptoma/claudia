-- 0026 — Realtime presence + co-editing foundation. Apply AFTER 0023–0025.
--
-- This is the app's first use of Supabase Realtime. It adds:
--   1. Realtime Authorization (RLS on realtime.messages) so a private channel is gated by the SAME
--      access predicates as the rest of the app — can_view_document / can_edit_document (from 0023).
--   2. public.document_collab — the canonical Yjs CRDT blob per document, for co-editing (Phase 2).
--
-- Channels (topics) this gates:
--   * doc:<uuid>         — presence ("who's viewing"). Join/observe needs VIEW; tracking needs VIEW.
--   * doc-collab:<uuid>  — co-editing broadcast. Join/observe needs VIEW; sending needs EDIT.
--
-- Fail-closed design (security-first): the topic helpers regex-validate the topic and return FALSE on
-- anything malformed, so a crafted topic can never reach the access predicates with a junk uuid. Sending
-- a broadcast (an actual edit) is the only thing that requires EDIT; presence is VIEW-only. Logged-out
-- users have no JWT on the socket, so `to authenticated` already excludes them.
--
-- Depends on 0023's can_view_document(uuid) / can_edit_document(uuid) (both SECURITY DEFINER, keying off
-- auth.uid()). auth.uid() resolves to the connecting user inside a realtime.messages policy.

-- ============================================================================
-- 1. Topic → access helpers
--    Parse `doc:<uuid>` / `doc-collab:<uuid>`, validate, delegate to the existing predicates.
--    SECURITY DEFINER + pinned search_path, mirroring the 0023 helpers. Fail closed on any parse miss.
-- ============================================================================
create or replace function public.can_view_doc_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m text[];
  v_id uuid;
begin
  -- Accept both the presence topic (doc:) and the collab topic (doc-collab:). Anchored regex, hex+dash
  -- only — anything else (empty, wrong prefix, extra segments) yields NULL → false.
  m := regexp_match(p_topic, '^doc(?:-collab)?:([0-9a-fA-F-]{36})$');
  if m is null then
    return false;
  end if;
  begin
    v_id := m[1]::uuid;
  exception when others then
    return false;  -- 36 chars that aren't a real uuid
  end;
  return public.can_view_document(v_id);
end;
$$;
revoke all on function public.can_view_doc_topic(text) from public, anon;
grant execute on function public.can_view_doc_topic(text) to authenticated;

create or replace function public.can_edit_doc_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m text[];
  v_id uuid;
begin
  m := regexp_match(p_topic, '^doc(?:-collab)?:([0-9a-fA-F-]{36})$');
  if m is null then
    return false;
  end if;
  begin
    v_id := m[1]::uuid;
  exception when others then
    return false;
  end;
  return public.can_edit_document(v_id);
end;
$$;
revoke all on function public.can_edit_doc_topic(text) from public, anon;
grant execute on function public.can_edit_doc_topic(text) to authenticated;

-- ============================================================================
-- 2. Realtime Authorization — RLS policies on realtime.messages
--    RLS is already enabled on realtime.messages by the Supabase platform; adding policies is what
--    opts these channels into authorization. `realtime.topic()` returns the current channel topic and
--    `realtime.messages.extension` is the message type ('presence' | 'broadcast' | 'postgres_changes').
-- ============================================================================

-- SELECT (subscribe / receive presence + broadcast): you must be able to VIEW the document. This covers
-- both doc:<id> (presence) and doc-collab:<id> (broadcast receive — a read-only grantee may observe but,
-- per the INSERT policy below, cannot send edits).
drop policy if exists "doc topic: receive when viewer" on realtime.messages;
create policy "doc topic: receive when viewer"
on realtime.messages
for select
to authenticated
using ( public.can_view_doc_topic((select realtime.topic())) );

-- INSERT (send): presence tracking needs only VIEW; sending a broadcast (a real edit) needs EDIT. Split
-- on the extension column so a viewer can appear in presence but cannot push co-editing changes.
drop policy if exists "doc topic: send presence as viewer, broadcast as editor" on realtime.messages;
create policy "doc topic: send presence as viewer, broadcast as editor"
on realtime.messages
for insert
to authenticated
with check (
  public.can_view_doc_topic((select realtime.topic()))
  and (
    realtime.messages.extension = 'presence'
    or (
      realtime.messages.extension = 'broadcast'
      and public.can_edit_doc_topic((select realtime.topic()))
    )
  )
);

-- ============================================================================
-- 3. public.document_collab — canonical Yjs blob (co-editing; Phase 2)
--    One row per document. `ydoc` is the merged Y.encodeStateAsUpdate(...) binary. The flat text still
--    lives in documents.content via the existing autosave path; this is the CRDT source of truth so a
--    reloading client restores exact structure without re-seeding (avoids the classic duplicate-content
--    pitfall). New table → the 0001 blanket grant does NOT cover it, so grant explicitly.
-- ============================================================================
create table if not exists public.document_collab (
  document_id uuid primary key references public.documents (id) on delete cascade,
  ydoc        bytea not null,
  updated_at  timestamptz not null default now()
);

grant select, insert, update on public.document_collab to authenticated;

alter table public.document_collab enable row level security;

-- Read the blob if you can view the doc; write it (seed + leader persistence) only if you can edit it.
drop policy if exists dc_select on public.document_collab;
create policy dc_select on public.document_collab
  for select to authenticated
  using ( public.can_view_document(document_id) );

drop policy if exists dc_insert on public.document_collab;
create policy dc_insert on public.document_collab
  for insert to authenticated
  with check ( public.can_edit_document(document_id) );

drop policy if exists dc_update on public.document_collab;
create policy dc_update on public.document_collab
  for update to authenticated
  using ( public.can_edit_document(document_id) )
  with check ( public.can_edit_document(document_id) );
-- No DELETE policy: rows die with their document via the ON DELETE CASCADE foreign key.
