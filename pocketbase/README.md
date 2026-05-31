# PocketBase — Claudia backend

PocketBase is a single Go binary providing auth + SQLite + file storage + an admin dashboard.
This folder holds the binary and the schema migration. Targets **PocketBase v0.39**.

## Run

```bash
./pocketbase serve
```

This auto-applies everything in `pb_migrations/` on startup and prints the admin dashboard URL.
On first run, open that URL and create the **superuser** (dashboard account).

If you don't have the binary yet, download the build for your OS from
<https://pocketbase.io/docs> (or the GitHub releases) and unzip it into this folder.

## Schema

[`pb_migrations/1700000000_init_schema.js`](pb_migrations/1700000000_init_schema.js) creates 5
collections:

| Collection | Type | Read | Write |
|---|---|---|---|
| `users` | auth | self or admin (`view`); admin (`list`) | self, no role change; admin delete |
| `projects` | base | public (`""`) | editor/admin |
| `folders` | base | public | editor/admin |
| `documents` | base | public | editor/admin |
| `media` | base | public | editor/admin |

### Two corrections baked into the migration (don't revert)

1. **Empty-string rules must be set via property assignment, not the `new Collection({...})`
   constructor.** In v0.39 the constructor drops `""` to `null` (which means *superusers only*),
   silently breaking public read. The migration sets `listRule`/`viewRule = ""` with a
   `publicRead()` helper *after* construction, which applies correctly.
2. **Role-escalation is blocked on BOTH create and update.** `users.createRule =
   "@request.body.role:isset = false"` stops a sign-up from POSTing `role:"admin"` to self-elevate;
   `users.updateRule` blocks it on edits. `users.viewRule` is `@request.auth.id = id ||
   @request.auth.role = 'admin'` so a user can read their own record while only admins can list all.

A public uploaded image is served at `${PB_URL}/api/files/media/{recordId}/{filename}`.

## Enable auth providers (Admin UI)

**Collections → users → Options:**

- **Email/password:** enable (on by default).
- **OAuth2 → Google / GitHub:** add each provider's client id + secret. Set the provider's
  **Authorization callback URL** to `${PB_URL}/api/oauth2-redirect` — for local dev that's
  `http://127.0.0.1:8090/api/oauth2-redirect` (use the `127.0.0.1` spelling consistently). GitHub
  OAuth apps allow only one callback URL, so use separate dev/prod apps.

## First admin

1. Register a normal account through the **app** (not the dashboard).
2. Dashboard → **Collections → users → your record → `role = admin`**.
3. Sign out / in again in the app so the new token carries the role.

## Production storage — Cloudflare R2

**Settings → Files storage → S3:** endpoint
`https://<accountid>.r2.cloudflarestorage.com`, bucket e.g. `claudia-media`, region `auto`, access
key/secret from an R2 API token, **Force path style = off**. Local dev uses local disk with no code
change.
