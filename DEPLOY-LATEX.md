# Deploy the LaTeX engine to production (WASM + TeX Live → R2)

The `latex` project type compiles **entirely in the browser** — no compile server. It loads the
[`texlyre-busytex`](https://github.com/TeXlyre/texlyre-busytex) engine (XeLaTeX, TeX Live 2026, AGPL-3.0)
and runs it in a Web Worker. Markdown projects don't touch any of this; **if you never enable LaTeX,
skip this whole file.**

The catch is the assets. The engine needs ~**480 MB** of files (the `.wasm` plus TeX Live `.data`
collections), four of which are **over Cloudflare Pages' 25 MiB per-file limit**, so they **cannot ship
with the Pages build**. They live in **Cloudflare R2** and are served from the app's own origin by a
Pages Function. This file is the runbook to wire that up. One-time, ~20 minutes.

> Already handled in the repo: the Function ([`frontend/functions/assets/busytex/[[path]].js`](frontend/functions/assets/busytex/%5B%5Bpath%5D%5D.js))
> and the long-cache rule in [`frontend/public/_headers`](frontend/public/_headers). You only need to
> create the bucket, upload the files, and bind it — steps 2–4 below.

---

## Why R2 + a same-origin Function (not Pages static, not an R2 custom domain)

- **Not Pages static assets** — `texlive-basic.data` (87 MB), `texlive-recommended.data` (190 MB),
  `texlive-extra.data` (324 MB) and `busytex.wasm` (31 MB) each exceed Pages' **25 MiB** file cap. The
  whole `public/assets/busytex/` dir is gitignored and never built into `dist/`.
- **Must be same-origin** — the engine starts a **classic** Web Worker via
  `new Worker('/assets/busytex/busytex_worker.js')`. Browsers **block classic workers loaded
  cross-origin**, so pointing the app at an R2 *custom domain* (a different origin) fails. Serving the
  same bytes from a **Function on `notes.byastro.dev`** is same-origin and works.
- **No COOP/COEP needed** — the engine uses `postMessage`, not `SharedArrayBuffer`, so we deliberately
  do **not** set cross-origin-isolation headers (they'd break Supabase signed images). See `_headers`.

So: assets in R2, fronted by `/assets/busytex/*` on the app domain. `VITE_BUSYTEX_BASE_PATH` stays
`/assets/busytex` in dev and prod — **no code change between environments.** Locally Vite serves the
files straight from `public/assets/busytex/` (no size limit); in prod the Function serves them from R2.

---

## 1. Fetch the assets locally

```bash
cd frontend
npm run fetch:tex-assets        # = texlyre-busytex download-assets ./public/assets
```

This populates `public/assets/busytex/` (~480 MB, gitignored). Confirm the big four are present:

```bash
ls -lh public/assets/busytex/{busytex.wasm,texlive-basic.data,texlive-recommended.data,texlive-extra.data}
```

You can compile LaTeX locally now (`npm run dev`) before doing anything below — local dev needs no R2.

---

## 2. Create the R2 bucket

R2 is free up to 10 GB storage + generous egress; ~0.5 GB here costs nothing.

```bash
cd frontend
npx wrangler login                       # once, opens a browser
npx wrangler r2 bucket create claudia-busytex
```

(Bucket name is arbitrary — `claudia-busytex` is the live bucket and is used throughout this doc.
Override with `BUSYTEX_BUCKET=…` for the scripts below.)

---

## 3. Upload `public/assets/busytex/*` to the bucket

Each object's key must equal its filename, so the Function can map `/assets/busytex/<key>` → R2 `<key>`.

**Use the Node uploader** — [`frontend/scripts/upload-latex-assets.mjs`](frontend/scripts/upload-latex-assets.mjs).
It uploads every file over R2's **S3-compatible API**, which does **multipart**. This matters:
`wrangler r2 object put` is single-shot and **hard-capped at 300 MiB**, so it physically cannot upload
`texlive-extra.data` (324 MiB) — it errors `Wrangler only supports uploading files up to 300 MiB`. The
S3 path has no such cap. (`@aws-sdk/client-s3` is just a library that speaks S3 to R2 — **no AWS account**.)

```bash
# a. Create a Cloudflare R2 API token (NOT AWS): dashboard → R2 → "Manage R2 API Tokens" →
#    Create API token → permission "Object Read & Write" (scope to the bucket). Copy the
#    Access Key ID + Secret Access Key it shows once.
# b. Add them to your gitignored frontend/.env.production (these are NOT VITE_-prefixed, so Vite
#    never bundles them into the client — they're only read by the upload script):
#        R2_ACCESS_KEY_ID=...
#        R2_SECRET_ACCESS_KEY=...
# c. Upload everything:
cd frontend
npm run upload:tex-assets
```

The `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` libs are already devDependencies, and the npm script
loads `.env.production` automatically (`--env-file-if-exists`), so creds never hit your shell history.

Re-run `npm run upload:tex-assets` after a future `npm run fetch:tex-assets` to push an engine upgrade
(it overwrites). Verify (note **`--remote`** — without it, `wrangler r2 object` hits a *local* simulator
and reports "Resource location: local", which is the usual "key does not exist" gotcha):

```bash
npx wrangler r2 object get claudia-busytex/texlive-extra.data --file /tmp/check.data --remote && ls -lh /tmp/check.data
```

> **Why not just wrangler?** It works for the files ≤ 300 MiB (and
> [`scripts/upload-latex-assets.sh`](frontend/scripts/upload-latex-assets.sh) does exactly that as a
> no-extra-token fallback), but it skips `texlive-extra.data`. Since you don't want to drop any
> packages, the Node/S3 uploader is the path that gets all four `.data` collections up.

---

## 4. Bind the bucket to the Pages project as `BUSYTEX`

The Function reads `env.BUSYTEX`. Bind the bucket under that exact name:

- Cloudflare dashboard → **Workers & Pages** → your Pages project → **Settings → Functions →
  R2 bucket bindings** → **Add binding**:
  - **Variable name:** `BUSYTEX`
  - **R2 bucket:** `claudia-busytex`
- Add it to the **Production** environment (and **Preview** too if you want LaTeX on preview deploys).
- **Re-deploy** the Pages project (bindings apply to new deployments). A redeploy of `main` is enough.

That's it — no env-var change. `VITE_BUSYTEX_BASE_PATH` already defaults to `/assets/busytex`.

---

## 5. Verify in production

```bash
# WASM served with the right type from the app origin:
curl -sI https://notes.byastro.dev/assets/busytex/busytex.wasm | grep -i 'content-type\|content-length\|cache-control'
#   content-type: application/wasm
#   content-length: ~32500000
#   cache-control: public, max-age=31536000, immutable

curl -sI https://notes.byastro.dev/assets/busytex/busytex_worker.js | grep -i content-type
#   content-type: text/javascript; charset=utf-8
```

Then in the app: create a **LaTeX** project (note the "beta" notice), open `main.tex`, hit **Compile**.
First compile pulls the WASM + `texlive-basic` (~120 MB, cached immutably afterward), so it's slow once
and fast after. A doc that uses a package beyond `texlive-basic` mounts `recommended`/`extra` on demand.

---

## Tuning what gets preloaded (optional)

Set these as **Pages Production env vars** to trade startup weight against package coverage (all are
read at build time by [`frontend/src/lib/latex/compiler.ts`](frontend/src/lib/latex/compiler.ts);
defaults are fine for launch). See [`frontend/src/lib/latex/README.md`](frontend/src/lib/latex/README.md)
for the architecture.

| Var | Default | Effect |
|---|---|---|
| `VITE_BUSYTEX_BASE_PATH` | `/assets/busytex` | Where the Function serves from. Leave as-is. |
| `VITE_BUSYTEX_COLLECTIONS` | `texlive-basic.js` | Collections **preloaded every compile** (the hot set). Keep small. |
| `VITE_BUSYTEX_CATALOG` | `texlive-basic.js,texlive-recommended.js,texlive-extra.js` | Collections mountable **on demand** when a doc uses a package they provide. Trim to cap peak worker memory; trimming also means fewer of the big `.data` files ever need to exist in R2. |
| `VITE_TEXLIVE_REMOTE_ENDPOINT` | _(empty)_ | Optional self-hosted `texlive-ondemand-server` for per-file packages beyond every local collection. No free public endpoint. |

If you trim the catalog (e.g. drop `texlive-extra.js`), you can also skip uploading that `.data` file
to R2 to save space — just keep the bucket and the env var in sync.

---

## Cost & limits

- **R2 free tier:** 10 GB storage, 1M Class-A + 10M Class-B ops/month, **zero egress fees**. ~0.5 GB
  and a handful of reads per user (then browser-cached for a year) sits comfortably in free.
- **No compile server, no per-compile cost** — compilation is the user's CPU.
- The 25 MiB cap is a **Pages** limit only; R2 has no such per-object cap.
