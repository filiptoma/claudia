# Supabase setup (hosted)

One-time setup of the backend. ~10 minutes. You only need a free Supabase account.

## 1. Create the project
- supabase.com → **New project** (free tier). Pick a region near you, set a DB password.
- Wait for it to provision.

## 2. Apply the schema + security rules
- In the dashboard: **SQL Editor → New query**. Run these two files **in order** (paste each, Run):
  1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) — tables, RLS policies
     (the whole access model), the signup + role-protection triggers, and the private `media`
     bucket + its policies.
  2. [`supabase/migrations/0002_sharing_rpcs.sql`](supabase/migrations/0002_sharing_rpcs.sql) — the
     invite-by-email helper functions (lets owners share without exposing the users table).

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
  `VITE_SUPABASE_ANON_KEY`. This is the browser-safe key (RLS protects the data).
  **Do NOT** use the **Secret key** (`sb_secret_…`) — it bypasses RLS and is server-only.
- Put them in `frontend/.env`:
  ```
  VITE_SUPABASE_URL=https://<your-ref>.supabase.co
  VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxx
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
