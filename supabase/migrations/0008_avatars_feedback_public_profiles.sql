-- 0008 — profile avatars, feedback table, public profiles RPC, project owner RPC.
-- Idempotent where possible. Apply to both dev and prod after 0001–0007.

-- ============================================================================
-- 1. avatar_url on profiles
-- ============================================================================
alter table public.profiles
  add column if not exists avatar_url text;

-- ============================================================================
-- 2. avatars storage bucket (public — URLs are opaque UUIDs, no auth needed to view)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,  -- 2 MB per avatar
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  file_size_limit     = excluded.file_size_limit,
  allowed_mime_types  = excluded.allowed_mime_types,
  public              = excluded.public;

-- Safe UUID parse for avatar storage paths (mirrors media_project_id pattern from 0007).
create or replace function public.avatar_owner_id(object_name text)
returns uuid language sql immutable set search_path = public as $$
  select case
    when (storage.foldername(object_name))[1]
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(object_name))[1])::uuid
  end;
$$;

drop policy if exists avatars_select on storage.objects;
drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;

-- Public bucket: anyone can read (URLs are unguessable UUIDs).
create policy avatars_select on storage.objects for select
  using (bucket_id = 'avatars');

-- Users can only write into their own folder ({userId}/avatar.ext).
create policy avatars_insert on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and auth.uid() = public.avatar_owner_id(name)
  );

create policy avatars_update on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and auth.uid() = public.avatar_owner_id(name)
  );

create policy avatars_delete on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and auth.uid() = public.avatar_owner_id(name)
  );

-- ============================================================================
-- 3. feedback table — bug reports and feature requests
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'feedback_type') then
    create type public.feedback_type as enum ('bug', 'request');
  end if;
end $$;

create table if not exists public.feedback (
  id          uuid        primary key default gen_random_uuid(),
  type        public.feedback_type not null,
  title       text        not null check (char_length(title) <= 200),
  description text        not null check (char_length(description) <= 5000),
  email       text,
  user_id     uuid        references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- Anyone authenticated can submit; anon cannot.
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert
  with check (auth.uid() is not null);

-- Only staff can read (contains potentially sensitive user reports).
drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback for select
  using (public.is_staff());

-- Staff can update (e.g. mark reviewed).
drop policy if exists feedback_update on public.feedback;
create policy feedback_update on public.feedback for update
  using (public.is_staff());

-- ============================================================================
-- 4. get_public_profile — safe read of name + avatar for any user who has
--    at least one public project. Accessible to anon (for public project pages).
-- ============================================================================
create or replace function public.get_public_profile(p_user uuid)
returns table (id uuid, name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.avatar_url
  from public.profiles p
  where p.id = p_user
    and exists (
      select 1 from public.projects pr
      where pr.owner = p.id
        and pr.is_public = true
        and pr.is_workspace = false
    );
$$;
revoke all on function public.get_public_profile(uuid) from public;
grant execute on function public.get_public_profile(uuid) to anon, authenticated;

-- ============================================================================
-- 5. get_project_owner — returns owner profile for project settings page.
--    Gated to project owner + staff (same as list_project_members).
-- ============================================================================
create or replace function public.get_project_owner(p_project uuid)
returns table (id uuid, name text, email text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email, p.avatar_url
  from public.profiles p
  join public.projects pr on pr.owner = p.id
  where pr.id = p_project
    and (public.is_staff() or public.is_project_owner(p_project));
$$;
revoke all on function public.get_project_owner(uuid) from public, anon;
grant execute on function public.get_project_owner(uuid) to authenticated;

-- ============================================================================
-- 6. list_public_projects — server-side pageable/filterable set of all public
--    non-workspace projects with owner display info. Accessible to anon.
-- ============================================================================
create or replace function public.list_public_projects()
returns table (
  id              uuid,
  name            text,
  slug            text,
  owner           uuid,
  owner_name      text,
  owner_avatar_url text,
  created_at      timestamptz,
  updated_at      timestamptz,
  document_count  bigint
)
language sql stable security definer set search_path = public as $$
  select
    pr.id,
    pr.name,
    pr.slug,
    pr.owner,
    p.name        as owner_name,
    p.avatar_url  as owner_avatar_url,
    pr.created_at,
    pr.updated_at,
    (
      select count(*)::bigint
      from public.documents d
      where d.project_id = pr.id
        and not d.is_quick_note
    ) as document_count
  from public.projects pr
  left join public.profiles p on p.id = pr.owner
  where pr.is_public = true
    and pr.is_workspace = false;
$$;
revoke all on function public.list_public_projects() from public;
grant execute on function public.list_public_projects() to anon, authenticated;
