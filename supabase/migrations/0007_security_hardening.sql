-- 0007 — security hardening, from the adversarial audit. Every change is fail-closed.
-- Idempotent (create-or-replace / drop-if-exists / update), so it is safe to re-run.
-- Apply to BOTH dev and prod, after 0001–0006.

-- ============================================================================
-- 1. find_profile_by_email was callable by ANONYMOUS users. New SECURITY DEFINER
--    functions get an implicit EXECUTE grant to PUBLIC (incl. anon), and 0002
--    never revoked it — so anyone with the publishable key could POST
--    /rest/v1/rpc/find_profile_by_email and turn it into a PRE-AUTH account-
--    enumeration + name/email harvest oracle (it bypasses profiles RLS). Make
--    the body fail closed for logged-out callers, and revoke the anon grant.  [HIGH]
-- ============================================================================
create or replace function public.find_profile_by_email(p_email text)
returns table (id uuid, name text, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  -- Invite-by-email is a logged-in share action. Closes the pre-auth oracle even
  -- if a grant is ever misconfigured again.
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.id, p.name, p.email
    from public.profiles p
    where lower(p.email) = lower(trim(p_email))
    limit 1;
end;
$$;
revoke all on function public.find_profile_by_email(text) from public, anon;
grant execute on function public.find_profile_by_email(text) to authenticated;

-- list_project_members already self-gates (is_staff or is_project_owner) so an
-- anon caller gets zero rows — but lock the grant down too, for defense in depth.
revoke all on function public.list_project_members(uuid) from public, anon;
grant execute on function public.list_project_members(uuid) to authenticated;

-- ============================================================================
-- 2. Media bucket had NO size or type limit -> any authenticated user could
--    stage arbitrary files (e.g. an HTML/SVG XSS payload) or exhaust the shared
--    free-tier storage quota. Cap size and restrict to raster image types
--    (deliberately excluding image/svg+xml, which can carry script).          [MEDIUM]
-- ============================================================================
update storage.buckets
set file_size_limit = 10485760, -- 10 MB per object
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']
where id = 'media';

-- ============================================================================
-- 3. profiles.email immutability. profiles_update_self lets a user PATCH any
--    column of their own row; rewriting `email` to a victim's address hijacks
--    invite-by-email (an owner inviting that address resolves to the attacker).
--    Block email changes the same way role changes are blocked — the canonical
--    email comes from the auth identity via the signup trigger.               [MEDIUM]
-- ============================================================================
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null => direct SQL / service role (admin bootstrap, data clone): allow.
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only admins can change roles';
    end if;
    if new.email is distinct from old.email then
      raise exception 'Email is managed by your auth identity and cannot be changed here';
    end if;
  end if;
  return new;
end;
$$;
-- (trigger profiles_protect_role from 0001 already calls this BEFORE UPDATE.)

-- ============================================================================
-- 4. Block promoting a regular project INTO a private workspace. Workspaces are
--    owner-only — hidden from members AND staff (0005). 0003 only guarded
--    *existing* workspaces, so an owner could flip is_workspace=true on a shared
--    project to hide it from collaborators and from moderation. is_workspace is
--    only ever set at creation (by the signup trigger).                        [LOW]
-- ============================================================================
create or replace function public.protect_workspace_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_workspace then
    -- can't rename / share / publish / un-flag an existing workspace
    if new.name is distinct from old.name
       or new.slug is distinct from old.slug
       or new.is_public is distinct from old.is_public
       or new.is_workspace is distinct from old.is_workspace then
      raise exception 'The workspace cannot be renamed, shared, or made public';
    end if;
  elsif new.is_workspace then
    -- can't convert a regular project into a workspace (would hide it)
    raise exception 'A project cannot be converted into a workspace';
  end if;
  return new;
end;
$$;
-- (trigger projects_protect_workspace_update from 0003 already calls this.)

-- ============================================================================
-- 5. set_updated_at was the one function missing a pinned search_path. Pin it
--    to harden against search_path manipulation.                              [INFO]
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

-- ============================================================================
-- 6. Storage media policies cast the path's first segment to uuid
--    unconditionally, so a malformed object name raised 22P02 (a hard error)
--    rather than cleanly denying. Parse it safely: a non-uuid segment yields
--    NULL, and can_view/can_edit_project(NULL) is false -> fail closed.        [LOW]
-- ============================================================================
create or replace function public.media_project_id(object_name text)
returns uuid language sql immutable set search_path = public as $$
  select case
    when (storage.foldername(object_name))[1]
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(object_name))[1])::uuid
  end;
$$;

drop policy if exists media_select on storage.objects;
drop policy if exists media_insert on storage.objects;
drop policy if exists media_delete on storage.objects;

create policy media_select on storage.objects for select
  using (bucket_id = 'media' and public.can_view_project(public.media_project_id(name)));
create policy media_insert on storage.objects for insert
  with check (bucket_id = 'media' and public.can_edit_project(public.media_project_id(name)));
create policy media_delete on storage.objects for delete
  using (bucket_id = 'media' and public.can_edit_project(public.media_project_id(name)));

-- ============================================================================
-- 7. handle_new_user copied the display name straight from user-controlled
--    signup metadata. Treat an empty name as missing and cap the length.      [LOW]
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)), 200)
  )
  on conflict (id) do nothing;

  insert into public.projects (name, slug, owner, is_public, is_workspace)
  values ('My Workspace', 'my', new.id, false, true)
  on conflict do nothing;
  return new;
end;
$$;
