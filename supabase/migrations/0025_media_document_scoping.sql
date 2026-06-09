-- 0025 — document-scoped media access. Apply after 0023 (needs can_view_document / can_edit_document).
--
-- Images now upload to `media/{project_id}/{document_id}/{file}` (the frontend's uploadImage adds the
-- document segment). This lets storage RLS gate an image on the DOCUMENT it belongs to instead of just
-- its project, closing the private-resource media leak: a private doc's images become readable only by
-- people who can view that doc, and a private-resource editor-grantee (who may be only a project viewer)
-- can upload into it.
--
-- BACKWARD COMPAT: legacy 2-segment paths `media/{project_id}/{file}` have no document segment, so they
-- fall back to PROJECT-level gating exactly as before (media_project_id still reads segment [1]). Existing
-- `storage:` references in document content are untouched and keep working.
--
-- KNOWN LIMITATION: images uploaded BEFORE this change (2-segment) stay project-scoped even inside a
-- doc that is later marked private — only newly-uploaded (3-segment) images are doc-scoped. Backfilling
-- would require moving storage objects + rewriting content references; out of scope here.

-- ---------- 1. Parse the document id from a 3-segment object path (null for legacy 2-segment paths) ----------
create or replace function public.media_document_id(object_name text)
returns uuid language sql immutable set search_path = public as $$
  select case
    when array_length(storage.foldername(object_name), 1) >= 2
     and (storage.foldername(object_name))[2]
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(object_name))[2])::uuid
  end;
$$;

-- ---------- 2. Doc-aware access for a media object (fall back to project for legacy paths) ----------
create or replace function public.can_view_media(object_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.media_document_id(object_name) is not null
      then public.can_view_document(public.media_document_id(object_name))
    else public.can_view_project(public.media_project_id(object_name))
  end;
$$;
-- Used in the media_select policy, which ANON evaluates for public-project images → must be anon-executable.
grant execute on function public.can_view_media(text) to anon, authenticated;

create or replace function public.can_edit_media(object_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.media_document_id(object_name) is not null
      then public.can_edit_document(public.media_document_id(object_name))
    else public.can_edit_project(public.media_project_id(object_name))
  end;
$$;
revoke all on function public.can_edit_media(text) from public, anon;
grant execute on function public.can_edit_media(text) to authenticated;

-- ---------- 3. Repoint the media policies at the doc-aware helpers ----------
drop policy if exists media_select on storage.objects;
create policy media_select on storage.objects for select
  using (bucket_id = 'media' and public.can_view_media(name));

drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert
  with check (bucket_id = 'media' and public.can_edit_media(name));

drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete
  using (bucket_id = 'media' and public.can_edit_media(name));
