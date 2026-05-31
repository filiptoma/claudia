# Claudia

A single-workspace, multi-course **markdown knowledge site** — inspired by HackMD, but much
simpler. Anonymous visitors get a clean, read-only site: a left sidebar that nests
**Project → Folder → Document**, with the selected document rendered as markdown. **Editors** and
**admins** sign in to get a HackMD-style **View / Split / Edit** control on each document — a
CodeMirror markdown source editor with a live preview — and can create/rename/delete content and
upload images. **Admins** also get a read-only **Users** dashboard.

- **Frontend:** Vite + React 18/19 + TypeScript, react-router v6, react-markdown (+ remark-gfm,
  rehype-slug), CodeMirror 6 (`@uiw/react-codemirror`), Inter + JetBrains Mono, `lucide-react` icons.
- **Backend:** [PocketBase](https://pocketbase.io) v0.39 (auth + SQLite + file storage + admin UI).
- **Image storage:** PocketBase file fields, backed by **Cloudflare R2** (S3-compatible) in
  production; local disk in dev (no code difference).
- **Hosting (free):** **Cloudflare Pages** for the frontend, a hosted PocketBase
  (PocketHost / Fly.io) for the backend, Cloudflare R2 for media.

There is exactly **one shared workspace**, visible to everyone. Three roles: `viewer` (default /
anonymous, read-only), `editor` (CRUD + uploads), `admin` (+ Users dashboard).

> ⚠️ All content and uploaded media are **world-readable** by design (public content site). Media
> file URLs are public and require no token — don't upload anything sensitive.

## Repo layout

```
claudia/
  frontend/        # Vite + React + TypeScript app
  pocketbase/      # PocketBase binary + pb_migrations/ (schema) + README
  scripts/         # optional markdown-folder importer
```

## Local development

### 1. PocketBase (backend)

```bash
cd pocketbase
# The pocketbase v0.39 binary should already be here; otherwise download it for your OS
# from https://pocketbase.io/docs (or GitHub releases) and unzip it into this folder.
./pocketbase serve            # applies pb_migrations/ automatically, prints the admin URL
```

On first run, open the printed admin URL and **create the superuser** (this is the PocketBase
dashboard account — it is NOT an app user). Then in the dashboard:

- **Collections → users → Options:** enable **Email/password**, and add **Google** and **GitHub**
  OAuth2 (each provider's client id/secret). See [`pocketbase/README.md`](pocketbase/README.md) for
  the exact OAuth callback URLs.

### 2. Frontend

```bash
cd frontend
cp .env.example .env          # VITE_PB_URL=http://127.0.0.1:8090
npm install
npm run dev                   # http://127.0.0.1:5173
```

> **Host spelling:** use `127.0.0.1` everywhere (Vite, `VITE_PB_URL`, and OAuth redirect URLs).
> Don't mix it with `localhost`, or OAuth/CORS/cookies can silently break.

### 3. Become an admin (two distinct identities)

PocketBase has **two** kinds of accounts — don't conflate them:

1. **`_superusers`** — the dashboard login you created on first `serve`. Not an app user; never
   appears in the in-app Users dashboard.
2. **app `users`** — accounts created through the app (email/password or OAuth).

To make yourself an app admin:

1. Register a normal account **in the app** (Sign in → Register).
2. In the PocketBase dashboard: **Collections → users → your record → set `role = admin`**.
3. **Sign out and sign in again** in the app so your new token carries `role=admin`.

Then you'll see the **View / Split / Edit** control on documents, the create/rename/delete
affordances in the sidebar, and `/admin/users`.

## Production deployment (all free)

### Backend — PocketBase

Pick one:

- **PocketHost** (recommended, managed): create an instance, upload `pb_migrations/`, create the
  superuser, enable the auth providers, and point storage at R2 (below). You get a
  `https://<name>.pockethost.io` URL.
- **Fly.io** (self-managed): deploy the binary in a tiny machine with a **persistent volume** mounted
  at the PocketBase data dir (SQLite must persist).

### Images — Cloudflare R2

In **PocketBase Admin → Settings → Files storage**, switch to **S3** and fill in R2 values:

| Setting | Value |
|---|---|
| Endpoint | `https://<accountid>.r2.cloudflarestorage.com` |
| Bucket | e.g. `claudia-media` |
| Region | `auto` |
| Access key / secret | from an R2 **API token** (S3 credentials) |
| Force path style | **off** (R2/AWS need it off; only MinIO needs it on) |

Local dev uses local disk — no code change, because file URLs stay `${PB_URL}/api/files/...` and
PocketBase serves/proxies them. R2 free tier: 10 GB + zero egress.

### OAuth

In the PocketBase Admin UI, add Google + GitHub apps and set each provider's redirect URL to
`${PB_URL}/api/oauth2-redirect`. Add your deployed frontend origin where the provider requires it.
(GitHub OAuth apps allow only one callback URL, so use separate dev/prod apps.)

### Frontend — Cloudflare Pages

```bash
cd frontend
npm run build                 # outputs dist/
```

Deploy on **Cloudflare Pages**:

- **Build command:** `npm run build` · **Build output directory:** `dist` · **Root directory:**
  `frontend`
- **Environment variable:** `VITE_PB_URL` = your deployed PocketBase URL.
- **SPA fallback:** handled by [`frontend/public/_redirects`](frontend/public/_redirects)
  (`/*  /index.html  200`) — Cloudflare Pages (and Netlify) honor it, so deep-link reloads work.

The app uses `BrowserRouter` with Vite `base: '/'` (clean URLs like `/algorithms/overview`).

## Optional: bulk import markdown

Seed a project from a folder of `.md` files (with local images rewritten to PocketBase URLs):

```bash
cd scripts
npm install
PB_URL=http://127.0.0.1:8090 PB_ADMIN_EMAIL=you@example.com PB_ADMIN_PW=... \
  npm run import -- --project "My Course" --dir /path/to/markdown
```

See [`scripts/import-folder.ts`](scripts/import-folder.ts).

## Acceptance checklist

See the in-repo verification steps; the short version: migration applies cleanly (5 collections),
anonymous read works with no edit UI, all three sign-in methods work, a promoted editor gets
View/Split/Edit with autosaving live preview, image upload works, CRUD + cascade-delete confirms
work, admins see `/admin/users`, and markdown (tables / fenced code / blockquotes / rose inline
`code` / images on a white plate) renders cleanly in light and dark mode.
