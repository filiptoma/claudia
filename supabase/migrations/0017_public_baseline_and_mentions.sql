-- 0017 — (1) a changeable default baseline role for public projects, and (2) @mentioning anyone who
-- can read a public project (not just members). Apply after 0001–0016 (single execution; no enum add).

-- ========== 1. Default baseline role for public projects ==========
-- Everyone who can access a PUBLIC project gets at least this tier — no per-person invite needed.
-- 'viewer' (default) keeps today's behaviour; 'commenter' lets anyone comment/suggest; 'editor' lets
-- anyone edit content without owner approval.
alter table public.projects
  add column if not exists public_role public.member_role not null default 'viewer';

-- can_comment: + anyone on a public project whose baseline is commenter/editor.
create or replace function public.can_comment_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and case
        when p.is_workspace then p.owner = auth.uid()
        else (
          p.owner = auth.uid()
          or exists (
            select 1 from public.project_members m
            where m.project_id = pid and m.user_id = auth.uid() and m.role in ('commenter', 'editor')
          )
          or (p.is_public and public.is_staff())
          or (p.is_public and auth.uid() is not null and p.public_role in ('commenter', 'editor'))
        )
      end
  )
$$;

-- can_edit: + anyone on a public project whose baseline is editor.
create or replace function public.can_edit_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and case
        when p.is_workspace then p.owner = auth.uid()
        else (
          p.owner = auth.uid()
          or exists (
            select 1 from public.project_members m
            where m.project_id = pid and m.user_id = auth.uid() and m.role = 'editor'
          )
          or (p.is_public and public.is_staff())
          or (p.is_public and auth.uid() is not null and p.public_role = 'editor')
        )
      end
  )
$$;

-- ========== 2. Mention anyone who can read a public project ==========
-- On a public project, any registered profile is a valid @mention target (they can read the doc and
-- will see it in their "Mentions" tab); private projects stay members-only.
create or replace function public.is_mentionable(p_project uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p where p.id = p_project and p.owner = p_user)
      or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = p_user)
      or exists (
        select 1 from public.projects p
        where p.id = p_project and p.is_public and not p.is_workspace
          and exists (select 1 from public.profiles pr where pr.id = p_user)
      );
$$;

-- Resolve a typed email to a mention target (the caller must be able to view the project; the target
-- must be mentionable in it). Used by the composer to mention non-members on public projects.
create or replace function public.find_mentionable_by_email(p_project uuid, p_email text)
returns table (id uuid, name text, email text, avatar_url text, member_role text)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.name, pr.email, pr.avatar_url,
         coalesce(
           (select m.role::text from public.project_members m where m.project_id = p_project and m.user_id = pr.id),
           case when exists (select 1 from public.projects p where p.id = p_project and p.owner = pr.id)
                then 'owner' else 'viewer' end
         ) as member_role
  from public.profiles pr
  where lower(pr.email) = lower(btrim(p_email))
    and public.can_view_project(p_project)
    and public.is_mentionable(p_project, pr.id)
  limit 1;
$$;

revoke all on function public.find_mentionable_by_email(uuid, text) from public, anon;
grant execute on function public.find_mentionable_by_email(uuid, text) to authenticated;
