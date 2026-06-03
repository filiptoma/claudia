-- Claudia — "My Workspace" + per-owner slugs.
--
-- My Workspace is a normal project row with is_workspace = true. It reuses the entire
-- folder/document hierarchy and all existing RLS; it is just special-cased so it cannot be
-- renamed, deleted, shared, or made public, and every user has exactly one (auto-created).
--
-- Slugs become unique PER OWNER instead of globally. The client appends a 4-char nanoid to real
-- project slugs (e.g. "exam-3kf9") so shared/public projects never collide; the workspace keeps
-- the bare slug "my". Because RLS scopes what each user can see, "my" resolving per-user is safe.

-- ---------- 1. workspace flag ----------
alter table public.projects
  add column if not exists is_workspace boolean not null default false;

-- ---------- 2. per-owner slug uniqueness (was global) ----------
alter table public.projects drop constraint if exists projects_slug_key;
alter table public.projects
  add constraint projects_owner_slug_key unique (owner, slug);

-- exactly one workspace per owner
create unique index if not exists projects_one_workspace_per_owner
  on public.projects (owner) where is_workspace and owner is not null;

-- ---------- 3. auto-create a workspace for every new user ----------
-- Extends the existing signup trigger: create the profile, then its private "My Workspace".
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.projects (name, slug, owner, is_public, is_workspace)
  values ('My Workspace', 'my', new.id, false, true)
  on conflict do nothing;
  return new;
end;
$$;

-- backfill: give every existing user a workspace if they don't have one yet. ON CONFLICT DO NOTHING
-- guards the rare case where a user already has a (non-workspace) project slugged 'my', so the
-- migration can't abort on the per-owner unique constraint.
insert into public.projects (name, slug, owner, is_public, is_workspace)
select 'My Workspace', 'my', p.id, false, true
from public.profiles p
where not exists (
  select 1 from public.projects w where w.owner = p.id and w.is_workspace
)
on conflict do nothing;

-- ---------- 4. protect the workspace (cannot rename / unprivate / unflag / delete) ----------
create or replace function public.protect_workspace_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Block renaming / sharing / publishing / un-flagging a workspace. NOTE: we deliberately do NOT
  -- guard the `owner` column — deleting a user cascades owner -> NULL (projects.owner is ON DELETE
  -- SET NULL), and blocking that would make user deletion fail.
  if old.is_workspace then
    if new.name is distinct from old.name
       or new.slug is distinct from old.slug
       or new.is_public is distinct from old.is_public
       or new.is_workspace is distinct from old.is_workspace then
      raise exception 'The workspace cannot be renamed, shared, or made public';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists projects_protect_workspace_update on public.projects;
create trigger projects_protect_workspace_update
  before update on public.projects
  for each row execute function public.protect_workspace_update();

create or replace function public.protect_workspace_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_workspace then
    raise exception 'The workspace cannot be deleted';
  end if;
  return old;
end;
$$;
drop trigger if exists projects_protect_workspace_delete on public.projects;
create trigger projects_protect_workspace_delete
  before delete on public.projects
  for each row execute function public.protect_workspace_delete();

-- ---------- 5. the workspace can never be shared ----------
create or replace function public.prevent_workspace_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.projects p where p.id = new.project_id and p.is_workspace) then
    raise exception 'The workspace cannot be shared';
  end if;
  return new;
end;
$$;
drop trigger if exists members_no_workspace on public.project_members;
create trigger members_no_workspace
  before insert or update on public.project_members
  for each row execute function public.prevent_workspace_membership();
