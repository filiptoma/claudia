-- Harden admin_projects: replace the SECURITY DEFINER *view* (0005) with a fail-closed
-- SECURITY DEFINER *function*.
--
-- Why: the view's only guard was a `where ... public.is_staff()` clause. That is safe today, but it
-- fails OPEN — if the clause is ever edited away, the view silently exposes every project + owner
-- email to all authenticated users. Postgres also can't attach RLS to a view, so it shows up
-- permanently as "Unrestricted" in the Supabase advisor.
--
-- A SECURITY DEFINER function with an explicit guard fails CLOSED: a non-staff caller gets an
-- exception, not a silent leak. It still bypasses RLS internally (definer) so staff can resolve every
-- owner's email — a deliberately narrow, gated escalation. PostgREST exposes it as the
-- `admin_projects` RPC; because it RETURNS TABLE and is STABLE, the client can still filter / sort /
-- paginate / count against it exactly like the old view.

drop view if exists public.admin_projects;

create or replace function public.admin_projects()
returns table (
  id          uuid,
  name        text,
  slug        text,
  is_public   boolean,
  owner       uuid,
  owner_name  text,
  owner_email text,
  created_at  timestamptz,
  updated_at  timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  -- Fail closed: only staff (mod/admin) may read this. is_staff() resolves the CALLING user
  -- (via auth.uid()) even inside a definer function, so this is the real authorization gate.
  if not public.is_staff() then
    raise exception 'forbidden: staff only' using errcode = '42501';
  end if;

  return query
    select p.id, p.name, p.slug, p.is_public, p.owner,
           op.name, op.email, p.created_at, p.updated_at
    from public.projects p
    left join public.profiles op on op.id = p.owner
    where not p.is_workspace; -- workspaces are private, never listed here
end;
$$;

-- New functions are granted to PUBLIC by default — revoke that, then allow only authenticated.
-- (The is_staff() guard is the real gate; this is defense in depth so anon can't even invoke it.)
revoke all on function public.admin_projects() from public, anon;
grant execute on function public.admin_projects() to authenticated;
