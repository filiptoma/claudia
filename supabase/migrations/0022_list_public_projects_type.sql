-- ============================================================================
-- 0022_list_public_projects_type
--
-- Expose each public project's `type` ('markdown' | 'latex') from list_public_projects so the public
-- "Browse all" cards can show a small .md / .tex badge (matching the dashboard and profile cards, which
-- read projects.type directly). Adding a column to a function's RETURNS TABLE changes its result type,
-- which CREATE OR REPLACE cannot do — so we drop and recreate. Behaviour is otherwise identical to 0008.
-- ============================================================================

drop function if exists public.list_public_projects();

create function public.list_public_projects()
returns table (
  id              uuid,
  name            text,
  slug            text,
  type            text,
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
    pr.type,
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
