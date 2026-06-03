# Claudia

A single-workspace, multi-course **markdown knowledge site** — inspired by HackMD, but simpler, with
**secure-by-default access control**. Visitors read public projects; signed-in users see what's been
shared with them and can create & own their own. **Editors** get a HackMD-style **View / Split /
Edit** control per document (CodeMirror source + live preview), can manage content, and upload
images. **Admins** also get a read-only **Users** dashboard.

- **Frontend:** Vite + React + TypeScript, react-router v6, TanStack Query, react-markdown
  (+ remark-gfm, rehype-slug, rehype-highlight), CodeMirror 6 (`@uiw/react-codemirror`, Material
  theme), Inter + JetBrains Mono, `lucide-react`.
- **Backend:** [Supabase](https://supabase.com) — Postgres + **Row Level Security**, Auth
  (email/password + Google + GitHub), and **private** Storage for images.
- **Hosting (free):** Cloudflare Pages (frontend) + hosted Supabase (backend).

## Access model (enforced in the database via RLS)

**Roles** (`profiles.role`): `basic` / `mod` / `admin`.
- **basic** — sees public projects + projects shared with them; can create & own their own.
- **mod** — can view/edit all content (no user management).
- **admin** — everything, plus the Users dashboard and role changes.

**Per project:** an `owner`, an `is_public` flag, and a `project_members` list of
(user, role∈{viewer, editor}). Folders/documents/media **inherit** the project's access.
- **view** = public **or** staff (mod/admin) **or** owner **or** a member.
- **edit content** = staff **or** owner **or** member with role `editor`.
- **manage** (rename/delete, change sharing) = staff **or** owner.
- Private / Shared / Public is **derived** (public flag + whether anyone's invited), not a stored
  type — so the label can never drift out of sync with the access list.

Everything is enforced by Postgres RLS, so the rules hold even if the frontend is bypassed.
Images live in a **private** Storage bucket and are served via short-lived **signed URLs** — an image
in a project you can't access is genuinely unreachable.

## Repo layout

```
claudia/
  frontend/                 # Vite + React + TypeScript app
  supabase/migrations/      # 0001_init.sql (schema + RLS + storage) … 0007_*.sql
  SUPABASE-SETUP.md         # one-time hosted-backend setup
  RUN.md                    # run & build
```

## Quick start

1. **Backend:** follow [SUPABASE-SETUP.md](SUPABASE-SETUP.md) — create a project, run the migrations
   `0001`–`0007` in order, configure auth, grab your API keys.
2. **Frontend:**
   ```bash
   cd frontend
   cp .env.example .env.development   # fill VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
   npm install
   npm run dev                        # http://127.0.0.1:5173
   ```
3. **Make yourself admin:** sign up, then in Supabase SQL editor:
   `update public.profiles set role = 'admin' where email = 'you@example.com';` — and sign in again.

See [RUN.md](RUN.md) for build/deploy details.

## Deployment (free)

- **Backend:** the hosted Supabase project (apply the migrations, enable auth providers, set
  redirect URLs).
- **Frontend:** `npm run build` → deploy `frontend/dist/` to **Cloudflare Pages** (root `frontend`,
  output `dist`), set the two `VITE_SUPABASE_*` env vars (`VITE_SUPABASE_URL` +
  `VITE_SUPABASE_PUBLISHABLE_KEY`), and add your Pages origin to Supabase → Authentication → URL
  Configuration. SPA fallback: [`frontend/public/_redirects`](frontend/public/_redirects).

> **dev + prod:** see [GO-TO-PROD.md](GO-TO-PROD.md) for the two-project (dev/prod) setup, local DB
> switching (`npm run dev` = dev, `npm run dev:live`/`build` = prod), and the go-live checklist.
