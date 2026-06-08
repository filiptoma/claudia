# LaTeX compile engine (`lib/latex`)

Client-side, in-browser LaTeX → PDF for the `latex` project type. **Nothing runs on a server** — the
[`texlyre-busytex`](https://github.com/TeXlyre/texlyre-busytex) WASM engine (TeX Live 2026, AGPL-3.0)
runs XeLaTeX in a Web Worker in the end-user's browser. No `SharedArrayBuffer`, so **no COOP/COEP
headers** (which would break Supabase images — see `public/_headers`).

## Files & the engine boundary (§3.14)

| File | Role |
|---|---|
| `compiler.ts` | **The ONLY file that imports `texlyre-busytex`.** Exposes `compileLatex(files, mainPath) → { pdf, log, errors, success }`. |
| `vfs.ts` | Builds the virtual filesystem (`LatexFile[]`) from documents + media + bundled TeX. No engine import. |
| `errors.ts` | Pure TeX-log → `ParsedError[]` parser. No engine import. |

**Boundary rule:** everything outside `compiler.ts` depends only on the app-owned types
(`LatexFile`, `CompileOutput`, `ParsedError`) — never on engine types (`BusyTexRunner`, `FileInput`,
`CompileOptions`, …). This keeps a future swap to upstream MIT `busytex` (if AstroNote ever goes
closed-source) confined to `compiler.ts` + asset repackaging.

## Engine assets (the big part)

The engine WASM + TeX Live data collections are **~480 MB** total and are **not** in git. Fetch them
into `public/assets/busytex/` (gitignored):

```bash
npm run fetch:tex-assets      # = texlyre-busytex download-assets ./public/assets
```

They're served at `VITE_BUSYTEX_BASE_PATH` (default `/assets/busytex`). Env overrides:

| Var | Default | Purpose |
|---|---|---|
| `VITE_BUSYTEX_BASE_PATH` | `/assets/busytex` | Same-origin base for worker + WASM + data packages. |
| `VITE_BUSYTEX_COLLECTIONS` | `texlive-basic.js` | Comma-sep collections **preloaded** (held resident) every compile. Keep this the small hot set. |
| `VITE_BUSYTEX_CATALOG` | `texlive-basic.js,texlive-recommended.js,texlive-extra.js` | Comma-sep collections **available on demand**: the resolver reads each loader's `\ProvidesPackage` list and mounts a collection's `.data` only when a doc uses a package from it. This is what lets packages beyond `texlive-basic` (`float`, `titlesec`, `caption`, `microtype`, …) resolve. Trim to cap peak worker memory. |
| `VITE_TEXLIVE_REMOTE_ENDPOINT` | _(empty = off)_ | On-demand CTAN/TeX Live mirror for packages past every local collection. No free public endpoint; self-host `texlive-ondemand-server`. |

> **Collections:** `texlive-basic` (~87 MB) = article/report + amsmath/graphicx/hyperref/geometry. `texlive-recommended` (~190 MB) adds `float`, `caption`, `microtype`, `booktabs`, `xcolor`, `parskip`, biblatex, … `texlive-extra` (~324 MB) adds `titlesec`, `placeins`, tikz, and the long tail. A collection is mounted whole the first time any of its packages is used, so a doc needing one `extra` package pulls the full 324 MB into the worker (cached for later compiles). For per-file granularity instead of whole-collection mounts, run a `texlive-ondemand-server` and set `VITE_TEXLIVE_REMOTE_ENDPOINT`.

## ⚠️ Production hosting (Cloudflare Pages)

**Pages caps individual static files at 25 MiB**, and the TeX Live `.data` collections (and possibly
the combined `.wasm`) exceed that — so you **cannot** serve `public/assets/busytex/` from Pages
directly. Local dev is fine (Vite has no size limit), so this only matters at deploy time.

**Recommended:** store the assets in **Cloudflare R2** and serve them at the **same-origin path**
`/assets/busytex/*` via an R2-bound Worker route on the app domain. The base path stays
`/assets/busytex` in both dev and prod (no code change). Same-origin matters because the engine loads
its Worker as a classic `new Worker('<base>/busytex_worker.js')`, which browsers block cross-origin —
so an R2 *custom domain* (a different origin) would not work, but an R2-backed *route on your domain*
does. Alternatively, run an on-demand TeX Live server and preload fewer/no collections via the env
vars above.
