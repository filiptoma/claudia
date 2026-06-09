-- 0024 — invite links (sign-in to redeem). Apply after 0023.
--
-- A tokenized link grants access on redemption by a SIGNED-IN user:
--   * whole project (folder_id + document_id both NULL) — used for PRIVATE projects, incl. LaTeX;
--   * a private folder/document (markdown projects only).
-- Access is identity-backed, so RLS keeps keying off auth.uid().
--
-- Fail-closed design:
--   * The redeemer must NOT be able to read invite_links (would harvest tokens / enumerate) → RLS is
--     manager-only and redemption goes solely through the SECURITY DEFINER redeem_invite() RPC.
--   * Tokens are generated SERVER-SIDE (never client-supplied) in create_invite_link().
--   * redeem_invite locks the row (FOR UPDATE) so max_uses isn't racy, increments uses only on success,
--     never downgrades an existing higher role, and rejects a private-project resource link for non-members.
--   * Token stored plaintext but RLS-gated to managers, revocable + expirable, re-displayable in the
--     manager panel (matches persistent share-link UX). Hashing + show-once is a future hardening toggle.

-- ============================================================================
-- 1. Table
-- ============================================================================
create table if not exists public.invite_links (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  project_id  uuid not null references public.projects (id)  on delete cascade,
  folder_id   uuid          references public.folders (id)   on delete cascade,
  document_id uuid          references public.documents (id) on delete cascade,
  role        public.member_role not null default 'viewer',
  created_by  uuid          references public.profiles (id)  on delete set null,
  expires_at  timestamptz,
  max_uses    int check (max_uses is null or max_uses > 0),
  uses        int not null default 0,
  revoked     boolean not null default false,
  created_at  timestamptz not null default now(),
  -- at most one resource target; both NULL = whole-project invite
  constraint invite_links_target_ck check (not (folder_id is not null and document_id is not null))
);

create index if not exists invite_links_project_idx on public.invite_links (project_id);

-- At most ONE active (non-revoked) link per target + role. Revoking a link frees its slot so a new one
-- can be made; there is no expiry (revocation is the control). Three partial unique indexes because a
-- target is project-level (both ids null), a folder, or a document.
create unique index if not exists invite_links_project_role_uk
  on public.invite_links (project_id, role)
  where folder_id is null and document_id is null and not revoked;
create unique index if not exists invite_links_folder_role_uk
  on public.invite_links (folder_id, role)
  where folder_id is not null and not revoked;
create unique index if not exists invite_links_document_role_uk
  on public.invite_links (document_id, role)
  where document_id is not null and not revoked;

-- New table: explicit grant (the 0001 blanket grant does not cover it). anon gets nothing.
grant select, insert, update, delete on public.invite_links to authenticated;

alter table public.invite_links enable row level security;

-- Manager-only for EVERYTHING. Redeemers never read this table; they use redeem_invite() (definer).
-- Listing / revoking / editing a link are plain RLS-gated table ops under these policies.
drop policy if exists il_select on public.invite_links;
create policy il_select on public.invite_links for select
  using (public.can_manage_project(project_id));
drop policy if exists il_insert on public.invite_links;
create policy il_insert on public.invite_links for insert
  with check (public.can_manage_project(project_id));
drop policy if exists il_update on public.invite_links;
create policy il_update on public.invite_links for update
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
drop policy if exists il_delete on public.invite_links;
create policy il_delete on public.invite_links for delete
  using (public.can_manage_project(project_id));

-- ============================================================================
-- 2. create_invite_link — manager-only; generates the token server-side; returns the raw token once.
-- ============================================================================
create or replace function public.create_invite_link(
  p_project uuid, p_folder uuid, p_document uuid, p_role public.member_role,
  p_expires_at timestamptz, p_max_uses int
) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text; v_type text; v_target_pid uuid;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public.can_manage_project(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_folder is not null and p_document is not null then
    raise exception 'an invite targets at most one resource';
  end if;

  -- a resource target must belong to this project
  if p_folder is not null then
    select project_id into v_target_pid from public.folders where id = p_folder;
    if v_target_pid is distinct from p_project then raise exception 'folder is not in this project'; end if;
  elsif p_document is not null then
    select project_id into v_target_pid from public.documents where id = p_document;
    if v_target_pid is distinct from p_project then raise exception 'document is not in this project'; end if;
  end if;

  -- resource-level invites are markdown-only
  select type into v_type from public.projects where id = p_project;
  if v_type = 'latex' and (p_folder is not null or p_document is not null) then
    raise exception 'resource-level invites are not available for LaTeX projects';
  end if;

  -- 2 random uuids → 64 hex chars (~244 bits). gen_random_uuid is core (PG13+); no pgcrypto/search_path issues.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  -- One active link per (target, role) — the partial unique indexes are the backstop for the UI guard.
  begin
    insert into public.invite_links (token, project_id, folder_id, document_id, role, created_by, expires_at, max_uses)
    values (v_token, p_project, p_folder, p_document, p_role, auth.uid(), p_expires_at, p_max_uses);
  exception when unique_violation then
    raise exception 'An active link with this permission already exists for this %. Revoke it first.',
      case when p_folder is not null then 'folder' when p_document is not null then 'document' else 'project' end
      using errcode = '23505';
  end;
  return v_token;
end;
$$;
revoke all on function public.create_invite_link(uuid, uuid, uuid, public.member_role, timestamptz, int) from public, anon;
grant execute on function public.create_invite_link(uuid, uuid, uuid, public.member_role, timestamptz, int) to authenticated;

-- ============================================================================
-- 3. redeem_invite — sign-in to redeem; fail-closed. Returns slugs so the UI can redirect to the target.
-- ============================================================================
create or replace function public.redeem_invite(p_token text)
returns table (project_id uuid, project_slug text, folder_slug text, document_slug text, kind text, role text)
language plpgsql security definer set search_path = public as $$
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
