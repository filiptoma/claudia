#!/usr/bin/env bash
# Bundle the M6 smoke test (resolving the app's extensionless TS imports) keeping the Typst engine
# external, then run it in Node against the real WASM compiler. See scripts/typst-smoke.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

# Output inside the project so Node resolves the externalized @myriaddreamin/* from ./node_modules.
OUT=".typst-smoke.bundle.mjs"
trap 'rm -f "$OUT"' EXIT

node_modules/.bin/rolldown scripts/typst-smoke.ts \
  -o "$OUT" \
  --format esm --platform node \
  --external '@myriaddreamin/typst.ts' \
  --external '@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs'

node "$OUT"
