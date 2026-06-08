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
npx wrangler r2 bucket create astronote-busytex
```

(Bucket name is arbitrary — `astronote-busytex` is used throughout this doc.)

---

## 3. Upload `public/assets/busytex/*` to the bucket

Each object's key must equal its filename, so the Function can map `/assets/busytex/<key>` → R2 `<key>`.
Upload every file (flat — there are no subdirectories), preserving content types:

```bash
cd frontend/public/assets/busytex
for f in *; do
  case "$f" in
    *.wasm) ct=application/wasm ;;
    *.js)   ct=text/javascript ;;
    *.json) ct=application/json ;;
    *.txt)  ct=text/plain ;;
    *)      ct=application/octet-stream ;;
  esac
  echo "→ $f ($ct)"
  npx wrangler r2 object put "astronote-busytex/$f" --file "$f" --content-type "$ct"
done
```

> The Function re-asserts the content type by extension anyway (so `instantiateStreaming` always gets
> `application/wasm`), but setting it on upload keeps the objects correct if ever served another way.

Re-run the same loop after a future `npm run fetch:tex-assets` to push an engine upgrade. Verify:

```bash
npx wrangler r2 object get astronote-busytex/busytex.wasm --file /tmp/check.wasm && ls -lh /tmp/check.wasm
```

---

## 4. Bind the bucket to the Pages project as `BUSYTEX`

The Function reads `env.BUSYTEX`. Bind the bucket under that exact name:

- Cloudflare dashboard → **Workers & Pages** → your Pages project → **Settings → Functions →
  R2 bucket bindings** → **Add binding**:
  - **Variable name:** `BUSYTEX`
  - **R2 bucket:** `astronote-busytex`
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
