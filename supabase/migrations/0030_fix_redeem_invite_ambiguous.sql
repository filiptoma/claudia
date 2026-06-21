-- 0030 — Fix redeem_invite() failing with 42702 "column reference \"project_id\" is ambiguous".
--
-- Cause: redeem_invite RETURNS TABLE (project_id uuid, ...). That OUT column name `project_id` is an
-- in-scope PL/pgSQL variable, so the bare `project_id` in `on conflict (project_id, user_id)` (the
-- project_members upsert) could refer to either the variable or the table column → 42702 at runtime,
-- so redeeming a project invite always failed.
--
-- Fix: the function never reads its OUT columns by name (it fills them positionally in the final
-- `return query select ...` using local v_* vars / qualified v.*), so we can safely tell PL/pgSQL to
-- resolve ambiguous identifiers to COLUMNS via `#variable_conflict use_column`. Return signature and
-- column names are unchanged, so the client contract (RedeemResult.project_id, ...) is preserved.
--
-- Apply after 0029 (via the dashboard SQL editor — no local Supabase here).

create or replace function public.redeem_invite(p_token text)
returns table (project_id uuid, project_slug text, folder_slug text, document_slug text, kind text, role text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v public.invite_links;
  v_uid uuid := auth.uid();
  v_is_public boolean;
  v_is_member boolean;
  v_project_slug text;
  v_folder_slug text;
  v_doc_slug text;
  v_kind text;
begin
  if v_uid is null then
    raise exception 'You must sign in to use this invite link' using errcode = '42501';
  end if;

  select * into v from public.invite_links l where l.token = p_token for update;
  if not found     then raise exception 'This invite link is invalid'        using errcode = '42501'; end if;
  if v.revoked     then raise exception 'This invite link has been revoked'  using errcode = '42501'; end if;
  if v.expires_at is not null and v.expires_at <= now()
                   then raise exception 'This invite link has expired'       using errcode = '42501'; end if;
  if v.max_uses is not null and v.uses >= v.max_uses
                   then raise exception 'This invite link has reached its use limit' using errcode = '42501'; end if;

  select p.is_public into v_is_public from public.projects p where p.id = v.project_id;
  v_is_member := public.is_member(v.project_id);

  if v.folder_id is null and v.document_id is null then
    -- PROJECT target → upsert membership; never downgrade an existing higher role.
    insert into public.project_members (project_id, user_id, role)
    values (v.project_id, v_uid, v.role)
    on conflict (project_id, user_id) do update
      set role = greatest(project_members.role, excluded.role);
    v_kind := 'project';

  else
    -- RESOURCE target (markdown by construction). PRIVATE project → members only.
    if not v_is_public and not v_is_member then
      raise exception 'This invite is for project members only — ask the owner to add you to the project first'
        using errcode = '42501';
    end if;

    if v.folder_id is not null then
      insert into public.resource_grants (project_id, folder_id, user_id, role, created_by)
      values (v.project_id, v.folder_id, v_uid, v.role, v.created_by)
      on conflict (folder_id, user_id)
        do update set role = greatest(resource_grants.role, excluded.role);
      v_kind := 'folder';
    else
      insert into public.resource_grants (project_id, document_id, user_id, role, created_by)
      values (v.project_id, v.document_id, v_uid, v.role, v.created_by)
      on conflict (document_id, user_id)
        do update set role = greatest(resource_grants.role, excluded.role);
      v_kind := 'document';
    end if;
  end if;

  -- success → count the use (a rejected attempt above never reaches here)
  update public.invite_links set uses = uses + 1 where id = v.id;

  -- resolve slugs for the redirect
  select slug into v_project_slug from public.projects where id = v.project_id;
  if v.folder_id is not null then
    select slug into v_folder_slug from public.folders where id = v.folder_id;
  elsif v.document_id is not null then
    select d.slug, f.slug into v_doc_slug, v_folder_slug
    from public.documents d left join public.folders f on f.id = d.folder_id
    where d.id = v.document_id;
  end if;

  return query select v.project_id, v_project_slug, v_folder_slug, v_doc_slug, v_kind, v.role::text;
end;
$$;
revoke all on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;
