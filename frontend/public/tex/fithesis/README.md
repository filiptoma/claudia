# Bundled TeX class/style files (fithesis)

This folder lets us ship LaTeX class/style files that aren't fetched from CTAN on demand — primarily
the Masaryk University **fithesis4** thesis class. The compiler's virtual filesystem builder
(`src/lib/latex/vfs.ts` → `fetchBundledTexFiles`) reads **`manifest.json`** here and adds each listed
file to the in-memory FS before compiling, so `\documentclass{fithesis4}` and its `\input`s resolve.

## How it works

`manifest.json` is a JSON array of paths, each **relative to this folder**. For every entry `p`:

- the file is fetched from `/tex/fithesis/<p>`, and
- it is placed in the compile's memfs at the path `<p>`.

So a manifest of `["fithesis4.cls", "style/base.sty"]` makes `fithesis4.cls` resolvable at the memfs
root and `style/base.sty` under `style/`. Mirror whatever directory layout the class `\input`s expect.

## Status — empty by design

The manifest is **`[]`** for now: fithesis support is **best-effort / a stretch goal** (plan §3.12),
and was never validated by the M1 spike. General LaTeX (article/report/…) compiles with **none** of
these files present — an empty manifest is a safe no-op. Populate it only after confirming fithesis
actually compiles in-browser (XeLaTeX + `\usepackage[backend=bibtex]{biblatex}`, fonts referenced by
filename — see the engine's limitations). Until then, Overleaf stays the backstop for the final thesis.

To populate: drop the fithesis4 `.cls` / `style/*.sty` / locale / logo files into this folder and list
them in `manifest.json`. These are a few MB and **are** committed (unlike the gitignored engine WASM).
