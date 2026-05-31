-- Claudia — Supabase schema + Row Level Security (secure by default).
-- Run this in the Supabase SQL editor (or via `supabase db push`).
--
-- Access model:
--   roles: basic | mod | admin  (mod+admin = "staff", bypass per-project checks)
--   per project: owner + is_public flag + project_members(user, role: viewer|editor)
--   view  = is_public OR staff OR owner OR member
--   edit  = staff OR owner OR member(editor)
--   manage (rename/delete/share) = staff OR owner
-- Folders/documents/media inherit their project's access. Everything is enforced in the DB.

-- ---------- enums ----------
create type public.user_role as enum ('basic', 'mod', 'admin');
create type public.member_role as enum ('viewer', 'editor');

-- ---------- tables ----------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  name       text,
  role       public.user_role not null default 'basic',
  created_at timestamptz not null default now()
);

create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  owner      uuid references public.profiles (id) on delete set null,
  is_public  boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  sort_order int not null default 0,
  unique (project_id, slug)
);

create table public.documents (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  slug       text not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  folder_id  uuid references public.folders (id) on delete cascade,
  content    text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create index on public.folders (project_id);
create index on public.documents (project_id);
create index on public.documents (folder_id);
create index on public.project_members (user_id);

-- ---------- helper functions (SECURITY DEFINER -> bypass RLS internally, avoid recursion) ----------
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role::text from public.profiles where id = auth.uid()), 'anon');
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() in ('mod', 'admin');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() = 'admin';
$$;

create or replace function public.is_member(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members m where m.project_id = pid and m.user_id = auth.uid());
$$;

create or replace function public.is_project_owner(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p where p.id = pid and p.owner = auth.uid());
$$;

create or replace function public.can_view_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and (p.is_public or public.is_staff() or p.owner = auth.uid() or public.is_member(pid))
  );
$$;

create or replace function public.can_edit_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and (
        public.is_staff()
        or p.owner = auth.uid()
        or exists (
          select 1 from public.project_members m
          where m.project_id = pid and m.user_id = auth.uid() and m.role = 'editor'
        )
      )
  );
$$;

-- ---------- triggers ----------
-- create a profile (role=basic) whenever an auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- only admins may change a role (blocks self-escalation even if RLS/UI is bypassed)
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end;
$$;
create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger projects_updated  before update on public.projects  for each row execute function public.set_updated_at();
create trigger documents_updated before update on public.documents for each row execute function public.set_updated_at();

-- ---------- grants (RLS still gates everything; grants just open the door) ----------
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- ---------- RLS ----------
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.folders         enable row level security;
alter table public.documents       enable row level security;

-- profiles: you can read yourself; admins read all (Users dashboard). Role change blocked by trigger.
create policy profiles_select        on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_self   on public.profiles for update using (id = auth.uid())      with check (id = auth.uid());
create policy profiles_update_admin  on public.profiles for update using (public.is_admin())    with check (public.is_admin());
create policy profiles_delete_admin  on public.profiles for delete using (public.is_admin());

-- projects
create policy projects_select on public.projects for select
  using (is_public or public.is_staff() or owner = auth.uid() or public.is_member(id));
create policy projects_insert on public.projects for insert
  with check (auth.uid() is not null and owner = auth.uid());
create policy projects_update on public.projects for update
  using (public.is_staff() or owner = auth.uid()) with check (public.is_staff() or owner = auth.uid());
create policy projects_delete on public.projects for delete
  using (public.is_staff() or owner = auth.uid());

-- project_members (sharing list): managed by owner/staff; a user can see their own membership
create policy members_select on public.project_members for select
  using (public.is_staff() or user_id = auth.uid() or public.is_project_owner(project_id));
create policy members_insert on public.project_members for insert
  with check (public.is_staff() or public.is_project_owner(project_id));
create policy members_update on public.project_members for update
  using (public.is_staff() or public.is_project_owner(project_id))
  with check (public.is_staff() or public.is_project_owner(project_id));
create policy members_delete on public.project_members for delete
  using (public.is_staff() or public.is_project_owner(project_id));

-- folders + documents inherit project access (view = can_view, write = can_edit)
create policy folders_select on public.folders for select using (public.can_view_project(project_id));
create policy folders_insert on public.folders for insert with check (public.can_edit_project(project_id));
create policy folders_update on public.folders for update using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy folders_delete on public.folders for delete using (public.can_edit_project(project_id));

create policy documents_select on public.documents for select using (public.can_view_project(project_id));
create policy documents_insert on public.documents for insert with check (public.can_edit_project(project_id));
create policy documents_update on public.documents for update using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy documents_delete on public.documents for delete using (public.can_edit_project(project_id));

-- ---------- storage: private media bucket, access mirrors project ----------
insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict (id) do nothing;

-- object path is "{project_id}/filename" -> gate on that project's access
create policy media_select on storage.objects for select
  using (bucket_id = 'media' and public.can_view_project(((storage.foldername(name))[1])::uuid));
create policy media_insert on storage.objects for insert
  with check (bucket_id = 'media' and public.can_edit_project(((storage.foldername(name))[1])::uuid));
create policy media_delete on storage.objects for delete
  using (bucket_id = 'media' and public.can_edit_project(((storage.foldername(name))[1])::uuid));
