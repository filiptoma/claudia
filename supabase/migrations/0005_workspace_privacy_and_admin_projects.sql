-- Claudia — Workspace privacy + admin projects view.
--
-- 1) My Workspace becomes truly private: a workspace and everything inside it (folders, documents,
--    media) is visible and editable ONLY by its owner — not by staff (mod/admin), not by anyone.
--    Staff retain full reach over normal (non-workspace) projects.
--
-- 2) The /admin/projects management table needs the project owner and updated_at. Owner email lives
--    in `profiles`, which is only readable by admins under RLS — so we expose a dedicated
--    `admin_projects` view that resolves the owner server-side and is gated to staff. The view
--    deliberately runs with definer privileges (it must read every owner's profile) and excludes
--    workspaces, so the admin table never lists anyone's private workspace.
--
-- Idempotent: safe to re-run in the Supabase SQL editor.

-- ---------- 1. workspace privacy ----------
-- can_view / can_edit gate folders, documents, and media. A workspace short-circuits to owner-only.
create or replace function public.can_view_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and case
        when p.is_workspace then p.owner = auth.uid()
        else (p.is_public or public.is_staff() or p.owner = auth.uid() or public.is_member(pid))
      end
  );
$$;

create or replace function public.can_edit_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and case
        when p.is_workspace then p.owner = auth.uid()
        else (
          public.is_staff()
          or p.owner = auth.uid()
          or exists (
            select 1 from public.project_members m
            where m.project_id = pid and m.user_id = auth.uid() and m.role = 'editor'
          )
        )
      end
  );
$$;

-- The projects table policies themselves: a workspace row is only visible / mutable to its owner.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select
  using (
    case
      when is_workspace then owner = auth.uid()
      else (is_public or public.is_staff() or owner = auth.uid() or public.is_member(id))
    end
  );

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update
  using (
    case when is_workspace then owner = auth.uid() else (public.is_staff() or owner = auth.uid()) end
  )
  with check (
    case when is_workspace then owner = auth.uid() else (public.is_staff() or owner = auth.uid()) end
  );

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete
  using (
    case when is_workspace then owner = auth.uid() else (public.is_staff() or owner = auth.uid()) end
  );
-- (projects_insert is unchanged: you may only insert a project you own.)

-- ---------- 2. admin projects view (staff-only, owner resolved, workspaces excluded) ----------
-- security_invoker = false (the default) so the view runs with its owner's privileges and can read
-- every project's owner profile. The `public.is_staff()` guard means non-staff callers get zero
-- rows, so this is safe to expose through PostgREST. Workspaces are filtered out entirely.
drop view if exists public.admin_projects;
create view public.admin_projects with (security_invoker = false) as
  select
    p.id,
    p.name,
    p.slug,
    p.is_public,
    p.owner,
    op.name  as owner_name,
    op.email as owner_email,
    p.created_at,
    p.updated_at
  from public.projects p
  left join public.profiles op on op.id = p.owner
  where not p.is_workspace and public.is_staff();

grant select on public.admin_projects to authenticated;
