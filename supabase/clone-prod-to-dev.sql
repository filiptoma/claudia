-- Mirror PROD content into DEV — entirely inside Supabase, via dblink. No external tools.
-- Run this in the DEV project's SQL editor. Re-runnable (each run replaces the cloned content).
--
-- WHAT IT DOES
--   Copies prod's non-workspace projects + their folders/documents into dev, RE-OWNED to your dev
--   admin. It does NOT copy auth users or profiles (so no real credentials/PII land in the less-
--   protected dev project) and it skips the sharing list — you browse all of it as the dev admin
--   (who owns the copies). Each user's private "My Workspace" (and its docs) is preserved, as is your
--   dev admin login. Add dev-only content freely afterwards; it's replaced on the next run.
--
-- SECRETS — the prod DB password is NEVER stored in this file (this file is committed to git, and the
-- password is a superuser-grade secret that bypasses RLS). It lives encrypted in the DEV project's
-- Supabase Vault and is referenced by name. Nothing secret ends up in git.
--
-- ONE-TIME SETUP (in the DEV project) — do these once; the URI is NOT typed into this committed file:
--   1. Enable the "dblink" extension: Database → Extensions → enable "dblink" (or run the
--      `create extension` line below). Supabase Vault is built in — the `vault` schema already
--      exists, nothing to enable.
--   2. Store prod's connection URI in Vault:
--      • Best (no SQL history): Dashboard → Project Settings → Vault → "Add new secret"
--          name  = prod_db_url
--          value = Supabase PROD → Connect → "Session pooler" URI, with the real password, e.g.
--                  postgresql://postgres.<PROD_REF>:<PW>@aws-1-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require
--      • Or via SQL (the password appears once in your editor history — clear it afterwards):
--          select vault.create_secret('<PROD_POOLER_URI>', 'prod_db_url', 'Prod URI for dev mirror');
--      • Rotate later:
--          select vault.update_secret((select id from vault.secrets where name = 'prod_db_url'), '<NEW_URI>');
--
-- BEFORE RUNNING: edit only the admin email on the marked line below (not a secret).
--
-- TIP — test connectivity first (reads the Vault secret; no password in the editor):
--   select * from extensions.dblink(
--     (select decrypted_secret from vault.decrypted_secrets where name = 'prod_db_url'),
--     'select 1') as t(ok int);

create extension if not exists dblink with schema extensions;

begin;

-- Pull the prod connection string from Vault (decrypted in-memory, transaction-local — never written
-- to this file, to git, or persisted past this transaction).
select set_config(
  'clone.prod',
  (select decrypted_secret from vault.decrypted_secrets where name = 'prod_db_url'),
  true
);

-- EDIT THIS: the email you sign in to DEV with (must already exist in DEV auth.users). Not a secret.
select set_config('clone.admin_email', 'itsfiliptoma@gmail.com', true);

-- Replace previously-cloned content. Deleting the non-workspace projects cascades to their folders,
-- documents and members. Workspaces (and their docs) are kept — they're per-user and private.
delete from public.projects where not is_workspace;

-- Projects: re-owned to the dev admin, with a collision-proof slug (unique per owner is required, and
-- all copies now share one owner). is_workspace forced false.
insert into public.projects (id, name, slug, owner, is_public, sort_order, created_at, updated_at, is_workspace)
select pr.id,
       pr.name,
       left(pr.slug, 40) || '-' || substr(replace(pr.id::text, '-', ''), 1, 6),
       (select id from auth.users where email = current_setting('clone.admin_email')),
       pr.is_public, pr.sort_order, pr.created_at, pr.updated_at, false
from extensions.dblink(
  current_setting('clone.prod'),
  'select id, name, slug, is_public, sort_order, created_at, updated_at
     from public.projects where not is_workspace'
) as pr(id uuid, name text, slug text, is_public boolean, sort_order int,
        created_at timestamptz, updated_at timestamptz);

-- Folders (original ids + project_id preserved → FKs line up with the projects just inserted).
insert into public.folders (id, name, slug, project_id, sort_order)
select * from extensions.dblink(
  current_setting('clone.prod'),
  'select f.id, f.name, f.slug, f.project_id, f.sort_order
     from public.folders f join public.projects p on p.id = f.project_id
     where not p.is_workspace'
) as t(id uuid, name text, slug text, project_id uuid, sort_order int);

-- Documents (original ids + project_id + folder_id preserved).
insert into public.documents (id, title, slug, project_id, folder_id, content, sort_order, created_at, updated_at, is_quick_note)
select * from extensions.dblink(
  current_setting('clone.prod'),
  'select d.id, d.title, d.slug, d.project_id, d.folder_id, d.content, d.sort_order,
          d.created_at, d.updated_at, d.is_quick_note
     from public.documents d join public.projects p on p.id = d.project_id
     where not p.is_workspace'
) as t(id uuid, title text, slug text, project_id uuid, folder_id uuid, content text,
       sort_order int, created_at timestamptz, updated_at timestamptz, is_quick_note boolean);

commit;

-- Note: image files in the `media` bucket are NOT copied (only the documents that reference them), so
-- images may 404 in dev. Fine for a dev mirror. NEVER run a dev→prod variant of this script.
