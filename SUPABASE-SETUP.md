# Supabase setup (hosted)

One-time setup of the backend. ~10 minutes. You only need a free Supabase account.

## 1. Create the project
- supabase.com → **New project** (free tier). Pick a region near you, set a DB password.
- Wait for it to provision.

## 2. Apply the schema + security rules
- In the dashboard: **SQL Editor → New query**. Run **all** migration files **in order**
  (paste each, Run). Wrap each paste in `begin; … commit;` so a partial run rolls back cleanly:
  1. [`0001_init.sql`](supabase/migrations/0001_init.sql) — tables, RLS policies (the whole access
     model), the signup + role-protection triggers, and the private `media` bucket + its policies.
  2. [`0002_sharing_rpcs.sql`](supabase/migrations/0002_sharing_rpcs.sql) — the invite-by-email
     helper functions (lets owners share without exposing the users table).
  3. [`0003_workspace_and_slugs.sql`](supabase/migrations/0003_workspace_and_slugs.sql) — per-user
     "My Workspace" + per-owner slug uniqueness.
  4. [`0004_quick_notes.sql`](supabase/migrations/0004_quick_notes.sql) — quick-notes flag + index.
  5. [`0005_workspace_privacy_and_admin_projects.sql`](supabase/migrations/0005_workspace_privacy_and_admin_projects.sql)
     — workspace privacy + the staff-only `admin_projects` view.
  6. [`0006_admin_projects_function.sql`](supabase/migrations/0006_admin_projects_function.sql) —
     replaces that view with a fail-closed staff-only `admin_projects()` function.
  7. [`0007_security_hardening.sql`](supabase/migrations/0007_security_hardening.sql) — audit
     hardening (lock down the email RPC, media upload limits, email immutability, storage guard, …).

## 2b. Applying migrations to dev + prod (and the grant-drift trap)

This project runs **two** Supabase databases: a **dev** project and a **prod** project (the prod one is
what Cloudflare Pages points at via `VITE_SUPABASE_URL`). **Every migration must be applied to BOTH**, in
order. New migrations (0008+) are applied the same way as section 2: paste each file, Run.

**The one rule that prevents the outage below: paste each migration file _verbatim_ from the repo into
each database. Never hand-copy, never paste a partial selection, never skip "boring" lines.**

### What actually goes wrong (the 0023 incident)

Postgres tables and functions are **deny-by-default** to the `anon` (logged-out) and `authenticated`
roles. The app's very first migration grants access in bulk:

```sql
grant select on all tables    in schema public to anon;             -- 0001
grant execute on all functions in schema public to anon, authenticated;
```

The trap: **`… on all … in schema public` only covers objects that exist at that moment.** Any table or
function added in a *later* migration is **not** covered and needs its **own** explicit `grant` line.
The later migrations include exactly those lines, e.g. in 0023:

```sql
grant execute on function public.can_view_folder(uuid)   to anon, authenticated;
grant execute on function public.can_view_document(uuid) to anon, authenticated;
grant select   on public.resource_grants                 to anon;
```

If a `grant` line like these gets **dropped during a hand-copy** (or you paste only "the interesting
part" of a migration), the table/function exists but the role can't touch it. Then:

1. The RLS policy on `folders` calls `can_view_folder(...)`, but `anon` has no **EXECUTE** on it.
2. Postgres raises `42501 permission denied for function can_view_folder`.
3. PostgREST returns that as **HTTP 401** on `/rest/v1/folders`.
4. That read is on the app's boot path, so the whole app sits on an **infinite loader**, even though the
   table, the policy, and the function all exist and look correct.

It's confusing precisely because "the migration ran fine" and "the table is there" — the only thing
missing is one `grant` line, and the symptom (401) looks like an auth/login problem, not a permissions
one. And if you fix it in the **wrong** database (dev when the app is hitting prod, or vice-versa) it
*stays* broken, because each project has its own independent grants.

### Verify after applying (catches drift in seconds)

Run this in **each** project's SQL editor; every `anon_ok` should be `true`:

```sql
select 'table:resource_grants'  as obj, has_table_privilege('anon','public.resource_grants','SELECT')::text          as anon_ok
union all select 'fn:can_view_project',  has_function_privilege('anon','public.can_view_project(uuid)','EXECUTE')::text
union all select 'fn:can_view_folder',   has_function_privilege('anon','public.can_view_folder(uuid)','EXECUTE')::text
union all select 'fn:can_view_document', has_function_privilege('anon','public.can_view_document(uuid)','EXECUTE')::text
union all select 'fn:is_project_owner',  has_function_privilege('anon','public.is_project_owner(uuid)','EXECUTE')::text;
```

> **Which database is the app hitting?** The `<ref>` in the failing request URL
> (`https://<ref>.supabase.co/rest/v1/…` in DevTools → Network) is the project to fix. Match it to the
> `VITE_SUPABASE_URL` in `frontend/.env.development` (local) or Cloudflare Pages env (prod). `[vite]
> connecting…` in the console means you're on **local dev** → it uses the **dev** DB.

### Recover if a read is 401-ing

Re-run the **current committed** migration file(s) verbatim in the affected project (every migration here
is idempotent — `create or replace`, `… if not exists`, `drop policy if exists`, repeatable `grant`s — so
re-running is safe and reconciles whatever drifted). The targeted hotfix for the 0023 case specifically:

```sql
grant select  on public.resource_grants                  to anon;
grant execute on function public.can_view_folder(uuid)   to anon, authenticated;
grant execute on function public.can_view_document(uuid) to anon, authenticated;
grant execute on function public.is_project_owner(uuid)  to anon, authenticated;
```

## 3. Configure auth
- **Authentication → Providers**:
  - **Email**: enabled by default. (For local testing you may turn **off** "Confirm email" so sign-ups
    log in immediately.)
  - **Google** and **GitHub**: enable each, paste the client id/secret from the provider's OAuth app.
- **Authentication → URL Configuration**:
  - **Site URL**: `http://127.0.0.1:5173`
  - **Redirect URLs**: add `http://127.0.0.1:5173/**`
  - In each OAuth provider (Google/GitHub), set the callback URL to the value Supabase shows
    (`https://<your-ref>.supabase.co/auth/v1/callback`).

## 4. Get your API keys
Supabase's newer projects use **Publishable / Secret** keys (the old `anon`/`service_role` naming).
- **Project URL** → `VITE_SUPABASE_URL`. Find it via the green **Connect** button at the top of the
  dashboard, or **Project Settings → Data API**. It's `https://<your-ref>.supabase.co`.
- **Publishable key** (`sb_publishable_…`, under **Project Settings → API Keys**) →
  `VITE_SUPABASE_PUBLISHABLE_KEY`. This is the browser-safe key (RLS protects the data).
  **Do NOT** use the **Secret key** (`sb_secret_…`) — it bypasses RLS and is server-only.
- Put them in `frontend/.env.development` (dev) — or `.env.production` for the prod project:
  ```
  VITE_SUPABASE_URL=https://<your-ref>.supabase.co
  VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxx
  ```

## 5. Make yourself admin
- Sign up in the app once (email/password). Then in **SQL Editor**:
  ```sql
  update public.profiles set role = 'admin' where email = 'you@example.com';
  ```
- Sign out and back in so your session reflects the new role.

## Roles
- **basic** (default) — sees public projects + projects shared with them; can create & own their own.
- **mod** — can view/edit all content (no user management).
- **admin** — everything, plus the Users dashboard and role changes.

> Security note: everything is enforced by Postgres RLS, so the rules hold even if the frontend is
> bypassed. Private/shared project images live in a **private** bucket and are served via short-lived
> signed URLs — unauthorized users cannot fetch them by URL.
