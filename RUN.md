# Run & Build Claudia

Two parts run side by side: **PocketBase** (backend, port 8090) and the **frontend** (Vite, port 5173).
Use two terminals. Requires Node ≥ 20.19.

---

## 1. Backend — PocketBase (Terminal 1)

```bash
cd pocketbase
./pocketbase serve
```

- Applies the schema migration automatically and prints the admin URL (http://127.0.0.1:8090/_/).
- **First run only:** open that URL and create the superuser (the dashboard login).

Leave this running.

---

## 2. Frontend (Terminal 2)

```bash
cd frontend
cp .env.example .env        # first time only — sets VITE_PB_URL=http://127.0.0.1:8090
npm install                 # first time only
npm run dev                 # http://127.0.0.1:5173
```

Open http://127.0.0.1:5173.

---

## 3. Become an editor/admin (to see View/Split/Edit + create content)

1. In the app: **Sign in → Register** a normal account.
2. In the PocketBase dashboard (http://127.0.0.1:8090/_/): **Collections → users → your record →
   set `role = admin`** (or `editor`).
3. Back in the app: **Sign out and sign in again** (the new role is in the token).

> Use `127.0.0.1` everywhere (not `localhost`) so auth/cookies stay consistent.

---

## Production build

```bash
cd frontend
npm run build               # type-checks + bundles into frontend/dist/
npm run preview             # optional: serve the built dist/ locally to test it
```

Deploy `frontend/dist/` to **Cloudflare Pages** (build command `npm run build`, output dir `dist`,
set env `VITE_PB_URL` to your deployed PocketBase URL). SPA fallback is handled by
`frontend/public/_redirects`.

---

## Stop

`Ctrl+C` in each terminal.

(Full details — OAuth setup, Cloudflare R2 storage, the optional markdown importer — are in
[README.md](README.md).)
