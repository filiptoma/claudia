#!/usr/bin/env bash
# Upload the LaTeX engine bundle (public/assets/busytex/*) to the production R2 bucket.
# See ../../DEPLOY-LATEX.md. Re-run after `npm run fetch:tex-assets` to push an engine upgrade.
#
# IMPORTANT: --remote is mandatory. Without it, `wrangler r2 object` writes to the LOCAL simulator
# (".wrangler/state"), not the real bucket the Pages Function reads from — the upload would look like
# it worked but production would still 404. wrangler prints "Resource location: local" in that case.
set -euo pipefail

BUCKET="${BUSYTEX_BUCKET:-claudia-busytex}"

# Resolve the asset dir relative to THIS script, so it works regardless of the current directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSET_DIR="$SCRIPT_DIR/../public/assets/busytex"

if [ ! -d "$ASSET_DIR" ]; then
  echo "Asset dir not found: $ASSET_DIR" >&2
  echo "Run 'npm run fetch:tex-assets' first." >&2
  exit 1
fi
cd "$ASSET_DIR"

# NOTE: upload-wasm-assets.mjs (S3 multipart) is the recommended uploader — it handles every file
# including the 324 MiB texlive-extra.data and needs no per-file size juggling. This wrangler script is
# kept only as a no-extra-token fallback for the files that fit: `r2 object put` is single-shot and
# hard-capped at 300 MiB, so anything larger (texlive-extra.data) is skipped here and must go via the .mjs.
WRANGLER_CAP=$((300 * 1024 * 1024))
oversized=()

for f in *; do
  [ -f "$f" ] || continue
  case "$f" in
    *.wasm) ct=application/wasm ;;
    *.js)   ct=text/javascript ;;
    *.json) ct=application/json ;;
    *.txt)  ct=text/plain ;;
    *)      ct=application/octet-stream ;;
  esac
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  if [ "$size" -gt "$WRANGLER_CAP" ]; then
    printf '⤫ %-38s %8.1f MiB  > 300 MiB — SKIPPED (use upload-wasm-assets-large.sh)\n' \
      "$f" "$(awk "BEGIN{print $size/1048576}")"
    oversized+=("$f")
    continue
  fi
  printf '→ %-38s %8.1f MiB  (%s)\n' "$f" "$(awk "BEGIN{print $size/1048576}")" "$ct"
  npx wrangler r2 object put "$BUCKET/$f" --file "$f" --content-type "$ct" --remote
done

echo
echo "Done (wrangler-eligible files). Verify: npx wrangler r2 object get $BUCKET/busytex.wasm --file /tmp/check.wasm --remote"
if [ "${#oversized[@]}" -gt 0 ]; then
  echo
  echo "⚠ ${#oversized[@]} file(s) over 300 MiB were skipped: ${oversized[*]}"
  echo "  Upload them with upload-wasm-assets.mjs (S3 multipart — handles all sizes)."
  echo "  See ../../DEPLOY-LATEX.md."
fi
