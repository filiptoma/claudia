// Same-origin route that serves the LaTeX engine assets (texlyre-busytex WASM + TeX Live `.data`
// collections, ~480 MB total) from a Cloudflare R2 bucket.
//
// WHY THIS EXISTS: the engine boots a CLASSIC web worker via `new Worker('/assets/busytex/busytex_worker.js')`,
// and browsers block classic workers loaded cross-origin — so the assets MUST be served from the app's
// own origin (notes.byastro.dev), not an R2 custom domain. They also can't ship with the Pages build:
// four files exceed Pages' 25 MiB per-file cap (texlive-basic 87 MB, recommended 190 MB, extra 324 MB,
// busytex.wasm 31 MB), and the bundle is gitignored anyway. So we keep them in R2 and proxy here.
//
// SETUP (one-time, see ../../../DEPLOY-LATEX.md):
//   1. Upload public/assets/busytex/* to an R2 bucket.
//   2. Bind that bucket to the Pages project as `BUSYTEX` (Settings → Functions → R2 bindings).
// With the bundle absent from the build, every /assets/busytex/* request falls through to this Function.

// WebAssembly.instantiateStreaming requires the exact `application/wasm` type; the worker loader needs a
// JS type; everything else is opaque binary. R2 may not persist a content-type, so we set it by extension.
const TYPES = {
  wasm: 'application/wasm',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  data: 'application/octet-stream',
  profile: 'application/octet-stream',
}

function contentType(key) {
  const ext = key.split('.').pop()?.toLowerCase()
  return (ext && TYPES[ext]) || 'application/octet-stream'
}

export async function onRequest(context) {
  const { request, env, params } = context

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  if (!env.BUSYTEX) {
    // Binding missing → loud 500 so a misconfigured deploy is obvious (rather than a cryptic engine hang).
    return new Response('R2 binding "BUSYTEX" is not configured on this Pages project.', { status: 500 })
  }

  // [[path]] is the catch-all after /assets/busytex/ → the R2 object key (e.g. "texlive-basic.data").
  const key = Array.isArray(params.path) ? params.path.join('/') : params.path
  if (!key) return new Response('Not Found', { status: 404 })

  // Honour Range so large .data fetches are resumable and the browser can stream them.
  const range = request.headers.get('range')
  const rangeOpt = parseRange(range)

  const object = await env.BUSYTEX.get(key, rangeOpt ? { range: rangeOpt } : undefined)
  if (!object) return new Response('Not Found', { status: 404 })

  const headers = new Headers()
  object.writeHttpMetadata(headers) // carries any stored content-type/encoding…
  headers.set('content-type', contentType(key)) // …but force the correct type regardless
  headers.set('etag', object.httpEtag)
  // Immutable, content-stable assets — mirror public/_headers so repeat visits don't re-pull 480 MB.
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  headers.set('access-control-allow-origin', '*')

  if (request.method === 'HEAD') {
    headers.set('content-length', String(object.size))
    return new Response(null, { status: 200, headers })
  }

  if (rangeOpt && object.range) {
    const { offset = 0, length = object.size } = object.range
    const end = offset + length - 1
    headers.set('content-range', `bytes ${offset}-${end}/${object.size}`)
    headers.set('content-length', String(length))
    return new Response(object.body, { status: 206, headers })
  }

  headers.set('content-length', String(object.size))
  return new Response(object.body, { status: 200, headers })
}

// Minimal single-range parser ("bytes=START-END"); returns an R2 range option or null for the whole object.
function parseRange(header) {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, startStr, endStr] = m
  if (startStr === '' && endStr === '') return null
  if (startStr === '') return { suffix: Number(endStr) } // last N bytes
  const offset = Number(startStr)
  if (endStr === '') return { offset } // from offset to end
  return { offset, length: Number(endStr) - offset + 1 }
}
