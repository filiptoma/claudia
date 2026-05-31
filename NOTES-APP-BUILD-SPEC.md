# Build Spec — "Notes": a HackMD-lite, PocketBase-backed knowledge site

> **How to use this file:** create a **new, empty folder** for the project, open Claude Code in it, and paste this whole document (or say *"follow NOTES-APP-BUILD-SPEC.md"*). This is the complete, standalone brief — build it from scratch, run PocketBase + the frontend locally, and verify against the acceptance criteria (§10) before considering it done. It does not depend on any other project or pre-existing files.

---

## 0. What we're building (one paragraph)

A single-workspace, multi-course **markdown knowledge site**, inspired by **HackMD but much simpler**. Anonymous visitors get a clean, read-only site: a left sidebar that nests **Project → Folder → Document**, and the selected document rendered as markdown (headings, tables, code, blockquotes, images). **Editor** and **admin** users sign in and get, on each document, a top-right **3-button group (View / Split / Edit)** that opens a HackMD-style editor: a markdown **source editor on the left** and a **live rendered preview on the right**. Edits **autosave (debounced)** the whole markdown back to the database. Editors/admins can create/rename/delete projects, folders and documents, and upload images (drag-and-drop or a toolbar button). **Admins** also get a read-only dashboard listing registered users. The backend is **PocketBase** (auth + database + file storage); uploaded images are stored on **Cloudflare R2** via PocketBase's S3 setting. There is exactly **one shared workspace**, visible to everyone — there is no per-user content and no sharing model beyond the three roles. The app starts **empty**; all content is created through the UI (an optional bulk importer is described in §7).

---

## 1. Tech stack & locked decisions (do not re-litigate)

- **Frontend:** Vite + React 18, **react-router-dom v6**. Use **BrowserRouter** if the chosen frontend host supports SPA fallback (Vercel/Netlify/Cloudflare Pages do); otherwise HashRouter. Set Vite `base: './'`.
- **Markdown render:** `react-markdown` + `remark-gfm` (GFM tables, etc.) + `rehype-slug` (heading ids).
- **Editor:** **CodeMirror 6** via **`@uiw/react-codemirror`** + `@codemirror/lang-markdown` (+ `@codemirror/language-data` for fenced-code language highlighting). This is a **HackMD-style markdown source editor with a live preview**, NOT a rich-text/contentEditable WYSIWYG — the source+preview model is required because it preserves complex tables and code blocks losslessly.
- **Fonts:** `@fontsource/inter` (UI + body) and `@fontsource/jetbrains-mono` (code), bundled so they work offline.
- **Backend:** **PocketBase** (single Go binary; auth + SQLite + file storage + admin dashboard). These instructions target the **v0.39** API; if the downloaded binary differs, adapt field/option names accordingly (run it locally and let it tell you — see §3 note).
- **PocketBase JS SDK:** the `pocketbase` npm package, used by the frontend and the optional import script.
- **File/image storage:** PocketBase file fields, backed by **Cloudflare R2** (S3-compatible) in production via PocketBase **Settings → Files storage → S3**. Local dev uses local disk (no code difference). R2 free tier = 10 GB + zero egress fees.
- **Auth:** PocketBase built-in — enable **email/password + Google OAuth2 + GitHub OAuth2**. No third-party auth service.

---

## 2. Roles & auth

Three roles, stored as a `role` field on the `users` auth collection:

- **viewer** — the default for any signed-in user, and the effective role of anonymous visitors. Read-only. (Most visitors never sign in; the content API is public-read.)
- **editor** — can create/edit/delete projects, folders, documents, and upload media.
- **admin** — everything an editor can do, plus access to the **Users** dashboard.

Rules:
- Anonymous (not logged-in) users can **read** everything but see no edit UI.
- New sign-ups (email/password or first OAuth login) get **no elevated role** — treat a missing/empty `role` as `viewer`. An **admin promotes** a user to editor/admin. For v1, role changes are made in the **PocketBase superuser dashboard** (the in-app Users dashboard is read-only).
- **Never let a user escalate their own role via the API** (enforced by `users.updateRule`, §3).
- First admin: after creating your account, set its `role = admin` in the PocketBase superuser UI.

OAuth client credentials (Google/GitHub) are configured in the **PocketBase Admin UI** (Settings → Auth providers), not in code — see §9.

---

## 3. Data model (PocketBase collections + API rules)

Create these via a **migration** (`pb_migrations/`) so the schema is reproducible. Below is a concrete starting migration using the **v0.39 JS migration API** (`new Collection`, typed field classes, `app.save`). Adapt option keys to the installed PB version if needed.

**Collections**

| Collection | Type | Fields | Read | Write |
|---|---|---|---|---|
| `users` | auth | + `role` (select: viewer/editor/admin, **not required**), `name` (text) | admin only | self (no role change); admin delete |
| `projects` | base | `name` (text, req), `slug` (text, req, unique), `order` (number) | public | editor/admin |
| `folders` | base | `name` (text, req), `slug` (text, req), `project` (relation→projects, req, cascade), `order` (number) | public | editor/admin |
| `documents` | base | `title` (text, req), `slug` (text, req), `project` (relation→projects, req, cascade), `folder` (relation→folders, optional, cascade), `content` (text, markdown, no max), `order` (number), `created`/`updated` (autodate) | public | editor/admin |
| `media` | base | `file` (file, single, images only), `document` (relation→documents, optional), `alt` (text) | public | editor/admin |

**Rule strings**
- Public read: `listRule = ""`, `viewRule = ""` (empty string = anyone; `null` = superusers only — do **not** use null for content).
- Editor/admin write (create/update/delete on projects, folders, documents, media): `"@request.auth.role = 'editor' || @request.auth.role = 'admin'"`.
- `users`: `listRule`/`viewRule` = `"@request.auth.role = 'admin'"`; `createRule = ""` (allow sign-up); `updateRule = "@request.auth.id = id && @request.body.role:isset = false"` (self-edit, but role changes blocked via API); `deleteRule = "@request.auth.role = 'admin'"`.

**Starter migration** — `pocketbase/pb_migrations/1700000000_init_schema.js`:

```js
/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const EDIT = "@request.auth.role = 'editor' || @request.auth.role = 'admin'"

  // ---- users: add role + name; lock down rules ----
  const users = app.findCollectionByNameOrId("users")
  users.fields.add(new SelectField({ name: "role", maxSelect: 1, values: ["viewer", "editor", "admin"] }))
  users.fields.add(new TextField({ name: "name", max: 100 }))
  users.listRule   = "@request.auth.role = 'admin'"
  users.viewRule   = "@request.auth.role = 'admin'"
  users.createRule = ""                       // allow self sign-up (effectively viewer)
  users.updateRule = "@request.auth.id = id && @request.body.role:isset = false"
  users.deleteRule = "@request.auth.role = 'admin'"
  app.save(users)

  // ---- projects ----
  const projects = new Collection({
    type: "base", name: "projects",
    listRule: "", viewRule: "", createRule: EDIT, updateRule: EDIT, deleteRule: EDIT,
    fields: [
      new TextField({ name: "name", required: true, max: 200 }),
      new TextField({ name: "slug", required: true, max: 200 }),
      new NumberField({ name: "order" }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_projects_slug ON projects (slug)"],
  })
  app.save(projects)

  // ---- folders ----
  const folders = new Collection({
    type: "base", name: "folders",
    listRule: "", viewRule: "", createRule: EDIT, updateRule: EDIT, deleteRule: EDIT,
    fields: [
      new TextField({ name: "name", required: true, max: 200 }),
      new TextField({ name: "slug", required: true, max: 200 }),
      new RelationField({ name: "project", required: true, maxSelect: 1, collectionId: projects.id, cascadeDelete: true }),
      new NumberField({ name: "order" }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_folders_project_slug ON folders (project, slug)"],
  })
  app.save(folders)

  // ---- documents ----
  const documents = new Collection({
    type: "base", name: "documents",
    listRule: "", viewRule: "", createRule: EDIT, updateRule: EDIT, deleteRule: EDIT,
    fields: [
      new TextField({ name: "title", required: true, max: 300 }),
      new TextField({ name: "slug", required: true, max: 300 }),
      new RelationField({ name: "project", required: true, maxSelect: 1, collectionId: projects.id, cascadeDelete: true }),
      new RelationField({ name: "folder", required: false, maxSelect: 1, collectionId: folders.id, cascadeDelete: true }),
      new TextField({ name: "content" }),               // markdown, no max
      new NumberField({ name: "order" }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_documents_project_slug ON documents (project, slug)"],
  })
  app.save(documents)

  // ---- media ----
  const media = new Collection({
    type: "base", name: "media",
    listRule: "", viewRule: "", createRule: EDIT, updateRule: EDIT, deleteRule: EDIT,
    fields: [
      new FileField({ name: "file", required: true, maxSelect: 1, maxSize: 5242880,
        mimeTypes: ["image/png","image/jpeg","image/gif","image/webp","image/svg+xml"] }),
      new RelationField({ name: "document", required: false, maxSelect: 1, collectionId: documents.id, cascadeDelete: false }),
      new TextField({ name: "alt", max: 300 }),
    ],
  })
  app.save(media)
}, (app) => {
  for (const n of ["media", "documents", "folders", "projects"]) {
    try { app.delete(app.findCollectionByNameOrId(n)) } catch {}
  }
})
```

> If the installed PocketBase rejects any field constructor/option, run `pocketbase serve` once, create one collection by hand in the dashboard to see the exact shape, then `./pocketbase migrate collections` to generate a correct snapshot and align the migration. Enabling **email/password + Google + GitHub** on the `users` collection is done in the **Admin UI** (Collections → users → Options) because it needs provider client IDs/secrets — don't hardcode secrets.

**Public file URLs:** an uploaded media record's image is served at `${PB_URL}/api/files/media/${record.id}/${record.file}`. The editor's upload handler (and the optional importer) insert exactly that URL into the markdown.

---

## 4. Repo structure to create

```
<project-root>/
  frontend/                # Vite + React app
    src/
      lib/pb.js                  # PocketBase client (reads VITE_PB_URL)
      context/AuthContext.jsx
      components/
        Sidebar.jsx              # project → folder → document tree (+ create/rename/delete)
        DocView.jsx              # rendered markdown
        Markdown.jsx             # react-markdown wrapper + styling component map
        ModeSwitch.jsx           # View / Split / Edit segmented control
        Editor.jsx               # CodeMirror + live preview split
        EditorToolbar.jsx        # bold/italic/heading/link/code/list/quote/image
        LoginModal.jsx           # Google / GitHub / email+password
        AdminUsers.jsx           # read-only users table
      App.jsx, main.jsx, index.css
    index.html, vite.config.js, package.json, .env.example
  pocketbase/
    pb_migrations/1700000000_init_schema.js
    README.md                    # download + run PB, apply schema, enable auth, point storage at R2
  scripts/
    import-folder.mjs            # OPTIONAL generic markdown-folder importer (§7)
  README.md                      # top-level run + deploy guide
```

`.env.example`: `VITE_PB_URL=http://127.0.0.1:8090`

---

## 5. Frontend spec (detailed)

**Routing**
- `/` → redirect to the first project's first document; if there is no content yet, show an **empty state** (a friendly message; if the viewer is an editor/admin, a "Create your first project" button).
- `/:projectSlug/:docSlug` → load and show that document.
- `/admin/users` → admin-only Users dashboard.
- Unknown → redirect home.

**Data loading**
- On boot, fetch `projects` (sorted by `order`, then `name`), `folders` (by project), and `documents` (id, title, slug, project, folder, order — **not** content) to build the sidebar tree. Fetch a document's `content` lazily when opened. Content is public-read, so this works with no auth.

**Sidebar (left)**
- Tree: **Project (collapsible)** → **Folder (collapsible)** → **Document**, plus documents that belong directly to a project (no folder) shown at the project's root level. Active document highlighted.
- Header: app name + a **dark/light theme toggle** + a **Sign in / account** control.
- For editor/admin: unobtrusive **"+"** affordances to create a project / a folder in a project / a document (in a folder or at project root), plus hover/context actions to **rename** and **delete** (with confirm). The tree refreshes after each change.

**Document view (main)**
- Render `content` with `react-markdown` + `remark-gfm` + `rehype-slug`. Images already contain absolute PocketBase URLs (from upload), so **no path rewriting** is needed at render time.

**Mode switch (top-right of a document) — editor/admin only**
- A **3-button segmented control: `View` · `Split` · `Edit`** (like HackMD's view/both/editor):
  - **View** = rendered only (what viewers see).
  - **Split** = CodeMirror markdown editor on the **left**, live `react-markdown` preview on the **right**, scroll-synced if practical.
  - **Edit** = editor only, full width.
- Hidden entirely for anonymous/viewer users.

**Editor (CodeMirror 6 via `@uiw/react-codemirror`)**
- Markdown language, soft line wrapping, app dark/light theme.
- **Toolbar** with buttons that wrap/insert at the selection via the CodeMirror view API (exposed through the component ref): **bold**, *italic*, heading, link, inline code, code block, bullet list, numbered list, blockquote, and **image upload**.
- **Debounced autosave:** ~**800 ms** after the last keystroke → `pb.collection('documents').update(id, { content })`. Show a small status: `Saving…` → `Saved <time>` → `Error` (with retry). Also save on blur and before unload. Last-write-wins is acceptable (≤5 users, no real-time collab). Disable the editor for non-editors.

**Image / media handling**
- **Drag-and-drop** an image onto the editor, **or** the toolbar **image** button → file picker.
- On either: `pb.collection('media').create(formData)` with the file (+ optional `document` relation and `alt`), then build `${VITE_PB_URL}/api/files/media/${rec.id}/${rec.file}` and insert `![alt](URL)` at the cursor. Show an inline "uploading…" placeholder until done. Storage backend is transparent (local in dev, R2 in prod).

**Auth UI**
- A **Sign in** button → modal offering **Google**, **GitHub**, and **email/password** (login + register):
  - OAuth: `pb.collection('users').authWithOAuth2({ provider: 'google' | 'github' })` (SDK popup flow).
  - Email/password: `authWithPassword(email, pw)`; register via `pb.collection('users').create({ email, password, passwordConfirm, name })`.
- Show the signed-in user (name/email + role) and **Sign out**. Persist the session via `pb.authStore`, wired into an `AuthContext`. Compute effective role from `pb.authStore.record?.role` (missing → viewer) and gate the edit UI on it.

**Admin dashboard `/admin/users` (admin only)**
- A read-only table of users: `name`, `email`, `role`, `created`. Note in the UI that roles are changed in the PocketBase dashboard (v1). Guard the route so non-admins are redirected.

### Design & styling requirements (build a polished UI from scratch)

- **Typography:** Inter for UI and body, JetBrains Mono for code. Comfortable reading: body ~1.02rem, line-height ~1.7, content column max-width ~**820px** centered; sidebar ~**300px**.
- **Dark/light theme** via CSS variables on `:root` / `[data-theme="dark"]`, toggle persisted in `localStorage`, default from `prefers-color-scheme`, and set before first paint (small inline script in `index.html`) to avoid a flash.
- **Markdown styling:** clear heading scale; `h2` with a bottom hairline rule; tables with cell borders, a shaded header row, and zebra striping, horizontally scrollable on small screens; **fenced code blocks** on a neutral panel (mono, scrollable); **inline `code`** in a subtle but visible **rose** — `#c2255c` on light / `#ff9ec5` on dark — on a faint tinted chip (code blocks stay neutral, not rose); **blockquotes** with an accent left border and a faint tinted background; **images** displayed on a white "plate" (white background + light border + padding + rounded corners) so dark-on-white diagrams remain legible in dark mode; constrained to container width.
- **Accent color:** a calm indigo (e.g. `#4f46e5` light / `#8aa2ff` dark) for links, active nav item, and the editor's mode-switch selection.
- **Responsive:** on narrow screens the sidebar becomes an off-canvas drawer with a hamburger toggle and a backdrop.
- Overall: clean, readable, modern — comparable to a well-designed docs site.

---

## 6. Cloudflare R2 (production image storage)

In **PocketBase Admin → Settings → Files storage**, switch to **S3** and fill in R2 values:
- Endpoint: `https://<accountid>.r2.cloudflarestorage.com`
- Bucket: e.g. `notes-media`
- Region: `auto`
- Access key / secret: from an R2 **API token** (S3 credentials).
- Force path-style: on.

Local dev uses local disk (default) — no frontend change, because file URLs stay `${PB_URL}/api/files/...` (PocketBase serves/proxies them). Connecting a public R2 bucket domain later is optional.

---

## 7. Optional bulk import utility — `scripts/import-folder.mjs`

A generic Node script (PocketBase JS SDK) to seed the app from a folder of markdown files — useful when you want to bulk-add an existing set of notes instead of typing them in. **Not required for the app to work.**

Behavior (all paths/params via env or args, nothing hardcoded):
1. Auth as superuser (creds from env, e.g. `PB_URL`, `PB_ADMIN_EMAIL`, `PB_ADMIN_PW`).
2. Create (or reuse) a project from `--project "Name"` (slug derived from the name).
3. For each `*.md` in `--dir <folder>` (sorted): read it; derive `slug` from the filename; `title` from the file's first `# H1` (fallback: filename); `order` from a leading number in the filename if present.
4. Find image links that point to **local files** (relative paths); upload each referenced file to `media`; replace the link with the PocketBase media URL.
5. Upsert the `documents` record by `(project, slug)` so re-runs don't duplicate.
6. Optionally map sub-folders of `--dir` to `folders` in the project.

Keep it generic — no assumptions about specific filenames or content.

---

## 8. Local dev runbook (put in README)

```bash
# 1. PocketBase
cd pocketbase
#   download the pocketbase binary for your OS from pocketbase.io (or its GitHub releases)
./pocketbase serve            # applies pb_migrations, prints the admin URL
#   -> open the admin URL, create the superuser, then Collections → users → Options:
#      enable Email/Password, add Google + GitHub OAuth (client id/secret)

# 2. Frontend
cd ../frontend
cp .env.example .env          # VITE_PB_URL=http://127.0.0.1:8090
npm install
npm run dev

# 3. Make yourself admin: PocketBase admin → users → your record → role = admin
#    Then sign in to the app and create your first project / folder / document.

# (optional) bulk import a folder of markdown:
# cd ../scripts && npm i pocketbase
# PB_URL=http://127.0.0.1:8090 PB_ADMIN_EMAIL=... PB_ADMIN_PW=... \
#   node import-folder.mjs --project "My Course" --dir /path/to/markdown
```

---

## 9. Deployment (all free)

**PocketBase server** — pick one:
- **PocketHost** (recommended, managed, free): create an instance, add the `pb_migrations`, set the superuser, enable auth providers, point storage at R2. You get a `https://<name>.pockethost.io` URL.
- **Fly.io** (free 1 GB volume, self-managed): deploy the binary in a tiny machine with a **persistent volume** mounted at the PB data dir (SQLite must persist). Include a `Dockerfile` + `fly.toml`.

**Images** → **Cloudflare R2** as in §6.

**OAuth** → in the PB Admin UI add Google + GitHub apps; set each provider's **redirect URL** to `${PB_URL}/api/oauth2-redirect`; add the deployed frontend origin where required.

**Frontend** → `npm run build`, deploy `dist/` to **Vercel / Netlify / Cloudflare Pages** (free). Set env `VITE_PB_URL` to the PocketBase URL. Use BrowserRouter (these hosts do SPA fallback) or HashRouter to be safe.

**CORS** → the PocketBase REST API allows cross-origin calls by default; verify the OAuth popup origin works from the deployed frontend.

---

## 10. Acceptance criteria (verify all before "done")

1. `pocketbase serve` applies the migration cleanly; the 5 collections exist with the rules above.
2. **Anonymous** visitor: can browse the sidebar tree and read any document (no login), and sees **no** edit UI / mode switch. With no content yet, a sensible empty state shows.
3. **Email/password, Google, and GitHub** sign-in all work; a fresh account is effectively a **viewer** (no edit UI).
4. After an admin sets a user to **editor**: that user sees the **View / Split / Edit** switch, can edit markdown in the split view with **live preview**, and edits **autosave** (status indicator visible; reload shows persisted content).
5. **Image**: drag-drop and toolbar upload both store the file in PocketBase (`media`) and insert a working `![](…)` that renders in the preview and the read view.
6. **CRUD**: editor/admin can create a project, a folder in it, and a document (in a folder and at project root); rename and delete work; the sidebar updates.
7. **Admin** sees `/admin/users` with the user list; non-admins cannot.
8. Tables, fenced code, blockquotes, and inline `code` (rose) render cleanly; images sit on the white plate and stay legible in dark mode.
9. Production build succeeds; the deployed frontend talks to the deployed PocketBase; uploaded images load from R2.
10. (If used) the optional importer brings a folder of markdown + local images into a project with links rewritten to PocketBase URLs.

---

## 11. Suggested build order

1. Scaffold `frontend` (Vite + React). Add `pocketbase` SDK, react-markdown stack, CodeMirror deps, fonts. Establish the theme + markdown CSS (§5 Design).
2. PocketBase: write + apply the migration; create superuser; enable auth providers.
3. Read path: PB client → fetch tree → Sidebar → DocView. Verify with a couple of hand-created records.
4. Auth context + LoginModal; gate edit UI by role; make yourself admin.
5. CRUD (projects/folders/documents) so you can create content from the UI.
6. Editor: CodeMirror split + preview + mode switch + debounced autosave.
7. Image upload (drag-drop + toolbar) → media → insert URL.
8. AdminUsers dashboard.
9. (Optional) `import-folder.mjs`.
10. R2 + deploy (PocketBase + frontend) + OAuth config. Walk the acceptance checklist.

---

## 12. Gotchas / notes

- **"WYSIWYG" here = HackMD source + live preview**, not a rich-text editor. Don't introduce a contentEditable rich editor — it mangles tables/code.
- **Role escalation:** the `users.updateRule` blocks `role` changes via the API; only the superuser dashboard changes roles in v1. Don't relax this.
- **Public read** uses empty-string rules (`""`), not `null` (null = superusers only).
- **PB version drift:** the field constructors/options target v0.39. If the binary differs, create one collection in the dashboard, run `./pocketbase migrate collections`, and align. The JS SDK record CRUD (`create`/`update`/`getList`/`authWithPassword`/`authWithOAuth2`) is stable across versions.
- **File URLs:** `${PB_URL}/api/files/{collection}/{recordId}/{filename}`. Keep media public-read so `<img>` works without a token.
- **One single shared workspace** — no per-user content, no sharing/permissions beyond the three roles.
- **Last-write-wins** is fine for ≤5 users; no real-time collaboration needed.
