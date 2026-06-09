# Enable Realtime presence + co-editing

This wires up two collaboration features, live over Supabase Realtime with **no backend of our own**:

1. **Presence — "who's viewing this document"** — an avatar stack in the document header.
2. **Co-editing — Google-Docs-style live editing** (Phase 2, now built) — when ≥2 people have the same
   markdown doc open in the editor, edits merge in real time (Yjs CRDT) with remote cursors, and the
   canonical state persists to the DB. Solo editing opens **no** channel, so it costs nothing.

See [.claude/plans/realtime-presence-coediting.md](.claude/plans/realtime-presence-coediting.md). Both
features are gated by the **same** access rules as the rest of the app, and migration 0026 (below) is the
single one-time DB step for **both** — there's nothing extra to apply for co-editing.

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
- **Broadcast** — carries the co-editing traffic (Yjs document updates + cursor awareness) on a separate
  `doc-collab:<uuid>` channel. Three safeguards keep it cheap: edits are batched (≤1 msg/250 ms), cursor
  awareness is throttled hard (≤1 msg/400 ms), and the channel only opens when **≥2** people are present,
  so solo editing sends nothing. Initial document state loads from the DB, not broadcast (no big messages).

Channels are **private** (`{ config: { private: true } }` in the client). A private channel is gated by
**Realtime Authorization**: RLS policies on the `realtime.messages` table. Migration 0026 adds those
policies, reusing the existing `can_view_document` / `can_edit_document` predicates (from 0023) via two
tiny topic-parsing helpers. That's the whole security model — there's no separate channel ACL to manage.

| Channel topic | Who can **join / observe** | Who can **send** |
|---|---|---|
| `doc:<uuid>` (presence) | can view the doc | can view the doc (track self) |
| `doc-collab:<uuid>` (co-editing broadcast) | can view the doc | can **edit** the doc |

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
- `public.document_collab` (the co-editing Yjs blob table) with explicit grants + RLS.

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

Presence and co-editing both live in the repo. Presence mounts at the app shell; the co-editing engine
(Yjs + `y-codemirror.next`) is bundled into the lazy editor chunk, so it loads only when someone opens the
editor. Just ship the normal build:

```bash
cd frontend
npm run build      # or your usual Cloudflare Pages deploy of main
```

`npm run build` (`tsc -b && vite build`) is green. No environment variables to set — the client talks to
the same `VITE_SUPABASE_URL` and uses the signed-in user's JWT for the private channels.

---

## 4. Verify the Definition of Done

The plan's **Verification** checklist. Most items need **two signed-in browser profiles** (two different
users, both with access) — they can't be checked from a single session. The binary transport and CRDT
convergence (codecs, two-peer merge, seed-no-duplication, join-sync) are additionally covered by an
offline logic check the author ran headlessly; the items below are the live, in-browser confirmations.

**Presence**

- [ ] **Two viewers see each other.** Open the same doc in two browser profiles. Each should see the
      other's avatar appear in the header within a second or two. The stack shows *others* only — you
      never see your own avatar, so a solo reader sees no stack.
- [ ] **Leaving removes the avatar.** Close one tab (or navigate away) → the other profile drops that
      avatar within the presence timeout (~seconds).
- [ ] **Two tabs = one avatar.** Open the doc in two tabs of the *same* profile → the other profile still
      shows just one avatar for that user (presence is keyed by `uid`).
- [ ] **Private doc is fail-closed.** As a user **without** a grant to a private doc, you can't open the
      doc at all (existing RLS), and the presence channel rejects them too. (To test the channel directly:
      in that user's console, `supabase.channel('doc:<that-doc-id>', { config: { private: true } }).subscribe()`
      should land in `CHANNEL_ERROR`, not `SUBSCRIBED`.)
- [ ] **Idle cost is near-zero.** Dashboard → **Realtime → Inspector** while a couple of viewers sit idle:
      message volume should be essentially flat (joins/leaves/heartbeats only).

**Co-editing** (open the doc in **edit** or **split** mode on both profiles)

- [ ] **Solo opens no channel → $0.** With **one** editor present, open the browser Network panel (WS
      frames) or the dashboard Realtime Inspector: there must be **no** `doc-collab:<id>` channel and no
      broadcast traffic. The doc still autosaves normally. This is the message-budget proof.
- [ ] **Live convergence, no dup/loss.** With **two** editors present, type in both **at the same time**.
      Within ~250 ms the text converges identically on both, with no duplicated or dropped characters, and
      each sees the other's coloured caret/selection. (Behind the scenes a `doc-collab:<id>` channel opened
      on the 1→2 transition.)
- [ ] **Reload restores from the DB.** After co-editing, reload one tab → the document comes back fully
      (read from `document_collab.ydoc`), not re-seeded from stale text.
- [ ] **Read-only grantee can't broadcast.** A user granted **view-only** on a private doc sees presence
      and (if they somehow reach the editor) cannot push edits: the `realtime.messages` INSERT policy
      rejects their broadcast (`extension='broadcast'` requires `can_edit_document`). Editors are
      unaffected.
- [ ] **Budget sanity.** During a ~5-minute 2-person session, read the Realtime message count in the
      dashboard and extrapolate: with the 250 ms/400 ms throttles it should sit far under 2M/month.

> **Tip:** the avatar stack (presence) is the cue that the collab channel is live — co-editing only
> activates while ≥2 people are present, which is exactly when you see another avatar.

---

## Quota fit (free plan)

Free Realtime gives **200 concurrent connections**, **2M messages/month**, **256 KB max message**.
Presence is join/leave/heartbeat only — a trickle. Co-editing is the part with a real budget, kept cheap
by three safeguards: **solo opens no channel** (so single-user editing is $0), edits batch to ≤1 msg/250 ms,
and cursor awareness throttles to ≤1 msg/400 ms. Even sustained 2–5-person sessions sit comfortably under
2M/month, and ≤200 connections is never the limit at this app's scale. Initial document state loads from
the DB (not broadcast), so large docs never risk the 256 KB message cap.
