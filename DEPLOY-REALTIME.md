# Enable Realtime presence (and the co-editing DB foundation)

This wires up **"who's viewing this document"** — an avatar stack in the document header, live over
Supabase Realtime, with **no backend of our own**. It also ships the database foundation for Phase 2
(Google-Docs-style co-editing), but that frontend is **not built yet**, so after this you get presence
only. See [.claude/plans/realtime-presence-coediting.md](.claude/plans/realtime-presence-coediting.md).

Everything is gated by the **same** access rules as the rest of the app: only a user who can *view* a
document can see or join its presence channel. Fail-closed. Logged-out visitors never appear and never
see the stack.

> **One-time, ~5 minutes, dashboard-only.** No Docker, no CLI, no code change — the app code is already
> in the repo (`usePresence`, `PresenceAvatars`, wired into the header). You only apply one migration and
> sanity-check that Realtime is on.

---

## Background: what actually makes this work

Supabase Realtime has three message kinds. We use two, and **neither needs the `supabase_realtime`
publication** (that's only for `postgres_changes` / database CDC, which we don't use here):

- **Presence** — each open tab `.track()`s a tiny `{ uid, joinedAt }` payload; everyone viewing renders
  an avatar stack. Cost is negligible (join / leave / heartbeat only — *no* per-keystroke traffic).
- **Broadcast** — reserved for Phase 2 co-editing; the migration authorizes it now so Phase 2 is a
  frontend-only change later.

Channels are **private** (`{ config: { private: true } }` in the client). A private channel is gated by
**Realtime Authorization**: RLS policies on the `realtime.messages` table. Migration 0026 adds those
policies, reusing the existing `can_view_document` / `can_edit_document` predicates (from 0023) via two
tiny topic-parsing helpers. That's the whole security model — there's no separate channel ACL to manage.

| Channel topic | Who can **join / observe** | Who can **send** |
|---|---|---|
| `doc:<uuid>` (presence) | can view the doc | can view the doc (track self) |
| `doc-collab:<uuid>` (broadcast, Phase 2) | can view the doc | can **edit** the doc |

Anti-spoof: the tracked payload carries only `uid`; display name/avatar are resolved client-side from
the authoritative member directory (`list_mentionable_users`), never from the payload — so a client
can't present itself as someone else.

---

## 1. Apply migration 0026

**Depends on 0023–0025 already being applied** (it reuses `can_view_document` / `can_edit_document` from
0023). If you haven't applied those yet, do them first, in order.

1. Supabase dashboard → your project → **SQL Editor** → **New query**.
2. Paste the **entire** contents of
   [supabase/migrations/0026_realtime_collab.sql](supabase/migrations/0026_realtime_collab.sql).
3. **Run.** It's idempotent (`create or replace`, `if not exists`, `drop policy if exists`), so re-running
   is safe.

This creates:
- `public.can_view_doc_topic(text)` / `can_edit_doc_topic(text)` — parse `doc:<uuid>` /
  `doc-collab:<uuid>`, regex-validated and **fail-closed** on anything malformed.
- Two RLS policies on `realtime.messages` (receive = viewer; send presence = viewer, send broadcast =
  editor).
- `public.document_collab` (the Phase-2 Yjs blob table) with explicit grants + RLS.

> **If the policy statements error** with a permission/ownership message: run the query as the project
> owner in the dashboard SQL editor (it executes as `postgres`, which Supabase authorizes to manage
> `realtime.messages` RLS). The SQL editor is the supported path; a restricted DB user over a direct
> connection may not have the grant.

### Confirm it took

Run this in the SQL editor — you should see **two** policies:

```sql
select policyname, cmd
from pg_policies
where schemaname = 'realtime' and tablename = 'messages'
order by cmd;
-- doc topic: receive when viewer                              | SELECT
-- doc topic: send presence as viewer, broadcast as editor     | INSERT
```

And the helper + table exist:

```sql
select 'helper' as kind, proname as name from pg_proc where proname like 'can_%_doc_topic'
union all
select 'table', 'document_collab' where to_regclass('public.document_collab') is not null;
```

---

## 2. Confirm Realtime is enabled for the project

Realtime is **on by default** for Supabase projects, and Presence/Broadcast need nothing beyond the
policies above. Just verify it isn't disabled:

- Dashboard → **Project Settings → Realtime** (or **Database → Realtime**): the service should be
  **enabled**. Default connection/message limits are fine — see *Quota* below.
- You do **not** need to add any table to the `supabase_realtime` **publication**. That toggle is for
  `postgres_changes` only; presence and broadcast don't use it. Leave it as-is.

No environment variables to set: the client already talks to the same `VITE_SUPABASE_URL` and uses the
signed-in user's JWT (it calls `supabase.realtime.setAuth()` before subscribing to the private channel).

---

## 3. Deploy the frontend

The presence code is in the repo and lazy-mounts in the document header. Just ship the normal build:

```bash
cd frontend
npm run build      # or your usual Cloudflare Pages deploy of main
```

> Note: the working tree currently has unrelated, in-progress edits in `AppHeader.tsx` (unused
> `Lock` / `canSetPermissions` / `permissions` symbols from the private-resources WIP) that make
> `tsc -b` fail with TS6133. Those are pre-existing and **not** from the presence feature — the Vite
> bundle (`npx vite build`) and `tsc --noEmit` pass. Clean those up (or finish that WIP) before a
> production `npm run build`.

---

## 4. Verify the Definition of Done

The plan's **Verification → Presence** checklist. Phase-1 items only (co-editing items belong to the
unbuilt Phase 2). Items 1–3 require **two signed-in browser profiles** — they can't be checked from a
single session.

- [ ] **Two viewers see each other.** Open the same doc in two browser profiles, each signed in as a
      different user **with access**. Each should see the other's avatar appear in the header within a
      second or two. The stack shows *others* only — you never see your own avatar (it's redundant with
      the profile menu), so a solo reader sees no stack.
- [ ] **Leaving removes the avatar.** Close one tab (or navigate away) → the other profile drops that
      avatar within the presence timeout (~seconds).
- [ ] **Two tabs = one avatar.** Open the doc in two tabs of the *same* profile → the other profile still
      shows just one avatar for that user (presence is keyed by `uid`).
- [ ] **Private doc is fail-closed.** As a user **without** a grant to a private doc, you can't open the
      doc at all (existing RLS), and the presence channel rejects them too — they observe nothing and
      never appear to the grantees. (To test the channel directly: in that user's console, a
      `supabase.channel('doc:<that-doc-id>', { config: { private: true } }).subscribe()` should land in
      `CHANNEL_ERROR`, not `SUBSCRIBED`.)
- [ ] **Idle cost is near-zero.** Dashboard → **Realtime → Inspector** while a couple of viewers sit
      idle on a doc: message volume should be essentially flat (joins/leaves/heartbeats only). This is
      the budget proof for presence.

---

## Quota fit (free plan)

Nothing to configure — just context. Free Realtime gives **200 concurrent connections**, **2M
messages/month**, **256 KB max message**. Presence is join/leave/heartbeat only: a handful of people on a
doc is a trickle, orders of magnitude under 2M/month, and ≤200 connections is never the limit for this
app's scale. (Phase 2 co-editing is the part with a real message budget — it's gated to open a broadcast
channel only when ≥2 people are present, so solo editing stays at $0. Not relevant until Phase 2 ships.)

---

## What's deferred to Phase 2 (not in this deploy)

`document_collab` and the broadcast authorization are live after step 1, but **unused** until the
co-editing frontend (Yjs + CodeMirror binding + the message-budget safeguards) is built. Until then,
no `doc-collab:` channel is ever opened and the table stays empty. See the plan's *Feature 2* section.
