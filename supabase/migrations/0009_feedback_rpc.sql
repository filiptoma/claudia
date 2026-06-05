-- 0009 — list_feedback RPC for admin feedback page.
-- Wraps the feedback table in a security-definer RPC so staff can query it
-- through the PostgREST API (filters/sort/pagination all work as usual).
-- Also adds explicit table grants in case the project defaults are absent.

-- ============================================================================
-- 1. Explicit grants on the feedback table
-- ============================================================================
-- Ensure authenticated users can insert (for bug/request submission).
grant insert on public.feedback to authenticated;

-- Grant select to authenticated so the RLS policy can even be evaluated.
-- The RLS policy (feedback_select) further restricts to staff only.
grant select on public.feedback to authenticated;

-- ============================================================================
-- 2. list_feedback — staff-only set-returning RPC for the admin feedback page.
--    PostgREST applies additional filter/sort/range params on the result.
-- ============================================================================
create or replace function public.list_feedback()
returns setof public.feedback
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from public.feedback;
end;
$$;

revoke all on function public.list_feedback() from public, anon;
grant execute on function public.list_feedback() to authenticated;
