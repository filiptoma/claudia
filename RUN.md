# Run & Build Claudia

Backend is **hosted Supabase** (no local server). You just run the frontend.
Requires Node ≥ 20.19.

## 0. One-time backend setup
Follow [SUPABASE-SETUP.md](SUPABASE-SETUP.md): create a Supabase project, run the migrations
`0001`–`0007` in `supabase/migrations/` **in order** (SQL Editor), set the Site/Redirect URLs, and
grab your API keys.

## 1. Configure the frontend
```bash
cd frontend
cp .env.example .env.development
```
Edit `frontend/.env.development` with your project's values (Supabase → Project Settings → API Keys):
```
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_… key>
```
> Use the browser-safe **publishable** key (`sb_publishable_…`), never the secret key. For the
> dev + prod two-project setup and local DB switching, see [GO-TO-PROD.md](GO-TO-PROD.md).

## 2. Run
```bash
cd frontend
npm install      # first time only
npm run dev      # http://127.0.0.1:5173  → DEV database
```
DB-switching scripts (which database each connects to is decided by the loaded env file):
```
npm run dev        # dev server  → DEV  (.env.development)
npm run dev:live   # dev server  → PROD (.env.production) — careful, live data
npm run build      # prod build  → PROD (.env.production) — what Cloudflare runs
npm run build:dev  # prod build  → DEV  (.env.development) — local pre-launch test
```

## 3. Become an admin
1. Sign up in the app (email/password).
2. In Supabase → SQL Editor: `update public.profiles set role = 'admin' where email = 'you@example.com';`
3. Sign out and back in.

Roles: **basic** (default — public + shared-with-them; can create & own their own projects),
**mod** (view/edit all content), **admin** (everything + the Users dashboard).

## Production build
```bash
cd frontend
npm run build    # type-checks + bundles into frontend/dist/
npm run preview  # optional: serve the built dist/ locally
```
Deploy `frontend/dist/` to **Cloudflare Pages** (build cmd `npm run build`, output `dist`, root
`frontend`), set `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` env vars, and add your Pages
URL to Supabase → Authentication → URL Configuration → Redirect URLs. SPA fallback is handled by
`frontend/public/_redirects`. Full dev/prod go-live walkthrough: [GO-TO-PROD.md](GO-TO-PROD.md).

## Stop
`Ctrl+C` in the terminal.
