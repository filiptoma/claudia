# Run & Build Claudia

Backend is **hosted Supabase** (no local server). You just run the frontend.
Requires Node ≥ 20.19.

## 0. One-time backend setup
Follow [SUPABASE-SETUP.md](SUPABASE-SETUP.md): create a Supabase project, run the two SQL files in
`supabase/migrations/` (SQL Editor), set the Site/Redirect URLs, and grab your API keys.

## 1. Configure the frontend
```bash
cd frontend
cp .env.example .env
```
Edit `frontend/.env` with your project's values (Supabase → Project Settings → API):
```
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

## 2. Run
```bash
cd frontend
npm install      # first time only
npm run dev      # http://127.0.0.1:5173
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
`frontend`), set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env vars, and add your Pages URL to
Supabase → Authentication → URL Configuration → Redirect URLs. SPA fallback is handled by
`frontend/public/_redirects`.

## Stop
`Ctrl+C` in the terminal.
