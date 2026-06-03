# Go to prod — dev + prod on the free tier (byastro.dev)

Two Supabase projects, one Cloudflare Pages site, free except the domain. The live app is served at
**`notes.byastro.dev`**.

| | **DEV** | **PROD** |
|---|---|---|
| Supabase project | existing `segwonmchgaivksqhqze` | new `claudia-prod` |
| Supabase org | same org (free = 2 active projects) | same org |
| Where it runs | local only (`npm run dev`) | Cloudflare Pages → `notes.byastro.dev` |
| Local env file | `frontend/.env.development` | `frontend/.env.production` |
| Sign-in methods | email/password only | email + Google + GitHub |
| Data | mirror of prod + your dev-only items | the real, live data |

---

## Where things stand

- [x] Repo prepared — env guard, `.env.development` / `.env.production`, mirror script, keep-alive workflow.
- [x] Security hardening migrations `0006` + `0007` applied to **dev**.
- [x] Cloudflare Pages build is live.
- [ ] **A.** Point `notes.byastro.dev` at the Pages site.
- [ ] **B.** Enable Google + GitHub on **prod only** (reuse your existing OAuth apps).
- [ ] **C.** Mirror prod → dev (Supabase-native, no external tools).
- [ ] **D.** First admin on prod + smoke test.
- [ ] Confirm `0006` + `0007` are also applied to **prod**, and that Cloudflare's **Production** env
      vars point at the **prod** Supabase (not dev).

> **Local DB switching** — the loaded env file decides which database you hit:
> ```
> npm run dev        # dev server  → DEV  (.env.development)
> npm run dev:live   # dev server  → PROD (.env.production) — live data, be careful
> npm run build      # prod build  → PROD (.env.production) — what Cloudflare runs
> npm run build:dev  # prod build  → DEV  (.env.development) — local pre-launch test
> ```
> Env files are gitignored; only `.env.example` is committed. The real prod build on Cloudflare uses
> the **dashboard** env vars (they override any file). Never put the `sb_secret_…` key anywhere client-side.

---

## A. Point `notes.byastro.dev` at the Pages site

**A1. Make sure `byastro.dev` is a zone on Cloudflare.**
- Cloudflare dashboard → **Add a domain** → enter `byastro.dev` → pick the **Free** plan.
- Cloudflare gives you two nameservers (e.g. `xILILILILILI.ns.cloudflare.com`). At the registrar where
  you bought `byastro.dev`, set the domain's nameservers to those two and save.
- Wait until the zone shows **Active** in Cloudflare (minutes–hours; you get an email).
- *If `byastro.dev` is already on Cloudflare (e.g. bought via Cloudflare Registrar), skip A1.*

**A2. Attach the subdomain to the Pages project.**
- Cloudflare → **Workers & Pages** → your Pages project → **Custom domains** tab →
  **Set up a custom domain** → enter `notes.byastro.dev` → **Continue** → **Activate domain**.
- Because the zone is on Cloudflare, it auto-creates a proxied `CNAME notes → <project>.pages.dev`
  and issues the TLS cert (Universal SSL — `.dev` is HTTPS-only, which this satisfies). It flips to
  **Active** in a minute or two.

**A3. Verify the Production env vars point at PROD.**
- Pages project → **Settings → Variables and Secrets** → **Production**:
  `VITE_SUPABASE_URL` = the **prod** project URL, `VITE_SUPABASE_PUBLISHABLE_KEY` = the **prod**
  `sb_publishable_…` key. If you change them, **re-deploy** (Vite bakes them in at build time).

**A4. Test:** open `https://notes.byastro.dev` — it should load over HTTPS and talk to the prod DB.

> Don't forget A's dependency on B: until you add `https://notes.byastro.dev` to the prod project's
> Supabase **Redirect URLs** (step B3), OAuth/email links won't return to the site.

---

## B. Google + GitHub sign-in on PROD only (reuse your existing OAuth apps)

You already created the Google client (Google Cloud console) and the GitHub OAuth app. We'll just
re-point them at the **prod** Supabase project and turn the providers **off** in dev. The login UI
already hides the Google/GitHub buttons in dev automatically (see note at the end).

**B1. Get prod's callback URL.**
- Supabase **PROD** → **Authentication → Providers → Google** (or GitHub). It shows
  **Callback URL (for OAuth)** = `https://<PROD_REF>.supabase.co/auth/v1/callback`. Copy it.

**B2. Re-point the existing OAuth apps at prod.**
- **Google** — [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services →
  Credentials** → your **OAuth 2.0 Client ID** → **Authorized redirect URIs**:
  remove the old dev URI (`https://segwonmchgaivksqhqze.supabase.co/auth/v1/callback`), **add** the
  prod callback from B1 → **Save**. Copy the **Client ID** and **Client secret**.
- **GitHub** — github.com → **Settings → Developer settings → OAuth Apps** → your app →
  set **Authorization callback URL** to the prod callback from B1 (GitHub allows exactly one) →
  **Update application**. Copy the **Client ID**; click **Generate a new client secret** if you don't
  have it saved.

**B3. Enable the providers on PROD Supabase.**
- Supabase **PROD** → **Authentication → Providers → Google** → toggle **ON**, paste Client ID +
  Secret → **Save**. Repeat for **GitHub**.
- Supabase **PROD** → **Authentication → URL Configuration**:
  - **Site URL** = `https://notes.byastro.dev`
  - **Redirect URLs** → add `https://notes.byastro.dev/**`
  - **Email confirm** = ON (Authentication → Providers → Email → "Confirm email").

**B4. Turn the providers OFF on DEV Supabase.**
- Supabase **DEV** → **Authentication → Providers → Google** → toggle **OFF** → Save. Same for GitHub.
- Leave **Email** enabled with **Confirm email = OFF** so local sign-up is instant.
- DEV URL Configuration: **Site URL** `http://localhost:5173`; **Redirect URLs**
  `http://localhost:5173/**`, `http://127.0.0.1:5173/**`.

> Because GitHub's single callback now points at prod, dev can't use GitHub anyway. Locally you sign
> in with **email/password**; the Google/GitHub buttons are hidden in the dev build (the UI gates them
> on `import.meta.env.PROD`, which is true only when the build targets the prod project).

---

## C. Mirror prod → dev (Supabase-native — no external tools)

Everything runs inside Supabase via the `dblink` extension; no `psql`/Docker/local tooling.

**Script:** [`supabase/clone-prod-to-dev.sql`](supabase/clone-prod-to-dev.sql).

The prod DB password is a superuser-grade secret (it bypasses RLS), so it is **never** put in this
git-tracked file. It lives encrypted in the DEV project's **Supabase Vault** and the script reads it
by name.

1. **One-time:** in **DEV** → **Database → Extensions** → enable **`dblink`**. (Vault is built in —
   the `vault` schema already exists, nothing to enable.)
2. **One-time:** store prod's URI in Vault — **DEV** → **Project Settings → Vault → Add new secret**
   (Integrations → Vault on some dashboards):
   - name = `prod_db_url`
   - value = Supabase PROD → **Connect** → **Session pooler** URI (with the real password), keep
     `?sslmode=require`.
   (This keeps the password out of the file, git, and even the SQL-editor history.)
3. Make sure you've already signed up in **dev** with `clone.admin_email` and promoted it to admin
   (step D2) — the clone re-owns content to that account. Then open the script, edit only
   `clone.admin_email`, paste the whole script into the **DEV** SQL editor and run it. Re-run anytime.

What it does (by design, for security + simplicity): copies prod's **non-workspace** projects and
their folders/documents into dev, **re-owned to your dev admin**. It does **not** copy auth users,
profiles, or the sharing list (so no real credentials/PII land in the less-protected dev project) —
you see all of it because the dev admin owns the copies. Each user's private **workspace is
preserved**, as is your dev login. Image files aren't copied, so images may 404 in dev (fine). Add
dev-only content freely afterward — it's replaced on the next run. **Never** run a dev→prod variant.

> First-time connectivity check (paste your URI):
> `select * from extensions.dblink('postgresql://…?sslmode=require','select 1') as t(ok int);`
> If dblink can't reach prod, tell me and we'll switch to `postgres_fdw` or revisit the approach.

---

## D. First admin (dev AND prod) + smoke test

1. Make sure `0006` + `0007` are applied to **prod** (Authentication and storage hardening). Verify
   parity:
   ```sql
   select count(*) from pg_policies where schemaname='public';            -- compare dev vs prod
   select tgname from pg_trigger where tgname='on_auth_user_created';     -- 1 row, on auth.users
   select id, public, file_size_limit, allowed_mime_types
     from storage.buckets where id='media';                              -- private + limits (0007)
   ```
2. **Promote your account to admin — do this in EACH project (dev and prod).** First sign up with that
   email in the app (DEV: `npm run dev` → email/password, instant since dev's email-confirm is off;
   PROD: on `https://notes.byastro.dev` once the domain is live). Then, in **that project's** SQL editor:
   ```sql
   select auth.uid();   -- must be NULL in the SQL editor, else the role guard blocks the next line
   update public.profiles set role='admin' where email='itsfiliptoma@gmail.com';
   select role from public.profiles where email='itsfiliptoma@gmail.com';   -- 'admin'
   ```
   Sign out/in so the session reflects the role. Do the **dev** one before running the mirror (C) —
   the clone re-owns the cloned content to that dev account.
3. **Smoke test `https://notes.byastro.dev`:** email + Google + GitHub sign-in; create a
   project/folder/doc; upload an image (renders via signed URL) and confirm a non-image is rejected;
   open the admin **Users** and **Projects** dashboards (the Projects list now comes from the
   fail-closed `admin_projects()` function — confirm search/sort/paging work). As a non-staff user,
   confirm the Projects dashboard is inaccessible.
4. **Keep-alive:** add repo secrets `PROD_SUPABASE_URL` + `PROD_PUBLISHABLE_KEY` so
   [`.github/workflows/keepalive.yml`](.github/workflows/keepalive.yml) pings prod daily (a free
   project auto-pauses after 7 idle days → the live domain would cold-start for the first visitor).

---

## Project setup reference (if a project isn't fully built yet)

**Create PROD** (same org, second project): supabase.com → your org → **New project** `claudia-prod`,
same region as dev, **save the DB password**. Security settings to match dev: **Enable Data API = ON,
Automatically expose new tables = OFF, Enable automatic RLS = ON**. Then SQL Editor → run migrations
`0001`–`0007` **in order**, each wrapped in `begin; … commit;` (`0001` isn't idempotent). Don't sign
up any user until `0001` is applied. **Don't** connect the project to GitHub (that's the paid
Branching integration and clashes with the hand-applied SQL flow).

**Reset the existing project → DEV** (only if you want a clean slate):
```sql
begin;
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all   on schema public to postgres, service_role;
commit;
```
Then re-run migrations `0001`–`0007`.

---

## Ongoing

- **Schema:** new `supabase/migrations/000N_*.sql` → run in **dev** SQL editor → test locally →
  run the **same file** in **prod** SQL editor → commit. Migrate the DB before deploying dependent code.
- **Code:** develop locally vs dev → push `main` → Cloudflare builds prod.
- **Re-mirror:** re-run [`supabase/clone-prod-to-dev.sql`](supabase/clone-prod-to-dev.sql) in the dev SQL editor.

## Free-tier notes

- **2 active projects per org** → dev + prod fit in one org. (500 MB DB is per project; egress and
  monthly-active-users allowances are pooled across the org — fine since dev is local-only.)
- Two-projects-per-environment *is* Supabase's free dev/prod best practice. The paid alternative is
  **Branching** (~$0.01/hr per branch) — not needed.
- Prod auto-pauses after 7 idle days (keep-alive handles it). Don't leave dev paused > 90 days (then
  deleted; download a DB backup + storage first if abandoning).
- Only the **domain** costs money.
