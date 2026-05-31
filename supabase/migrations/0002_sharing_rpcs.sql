-- Sharing helpers. The profiles table is only readable by yourself or an admin (privacy), so a
-- regular owner can't list users to share with. These SECURITY DEFINER functions let an owner
-- invite collaborators by email (Google-Docs style) and list a project's members with their names.

-- Resolve an email to a profile (id/name/email only — never the role).
create or replace function public.find_profile_by_email(p_email text)
returns table (id uuid, name text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email
  from public.profiles p
  where lower(p.email) = lower(trim(p_email))
  limit 1;
$$;

-- List a project's members with their profile info — only for someone who can manage the project.
create or replace function public.list_project_members(p_project uuid)
returns table (user_id uuid, name text, email text, role public.member_role)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.name, p.email, m.role
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.project_id = p_project
    and (public.is_staff() or public.is_project_owner(p_project))
  order by p.name nulls last, p.email;
$$;

grant execute on function public.find_profile_by_email(text) to authenticated;
grant execute on function public.list_project_members(uuid) to authenticated;
