-- get_profile_by_id — fetch name + avatar for any user by ID, regardless of whether
-- they have public projects. Exposes only non-sensitive columns (no email, no role).
-- Used by the public profile page to distinguish "user not found" from "no public projects".
create or replace function public.get_profile_by_id(p_user uuid)
returns table (id uuid, name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.avatar_url
  from public.profiles p
  where p.id = p_user;
$$;
revoke all on function public.get_profile_by_id(uuid) from public;
grant execute on function public.get_profile_by_id(uuid) to anon, authenticated;
