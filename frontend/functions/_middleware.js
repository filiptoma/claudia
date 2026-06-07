// Cloudflare Pages edge middleware — link-preview (Open Graph) titles.
//
// AstroNote is a client-rendered SPA: the browser sets <title> via JS after the bundle loads. But
// link-preview crawlers (Messenger, Discord, Slack, Facebook, X, iMessage…) are unauthenticated and
// DON'T run JS — they read the meta tags in the raw HTML. So a shared document link would otherwise
// always preview as the generic "AstroNote".
//
// This middleware runs on every full-page load (not client-side navigations). For a document URL it
// resolves the document's title via the public_document_title RPC and rewrites the served index.html's
// <title> / og:title / twitter:title with it (HTMLRewriter, streamed). It only ever resolves titles
// for PUBLIC projects (the RPC enforces this), so private/workspace/quick-note links fall back to the
// static "AstroNote" defaults baked into index.html — nothing private leaks into a preview.

const APP_NAME = 'AstroNote'

// Top-level URL segments that are app routes, never a project slug — skip the document lookup for them.
const RESERVED_TOP = new Set(['profile', 'explore', 'bug', 'request', 'admin', 'users', 'login'])

// A request for a built asset (has a file extension) — never HTML, so don't touch it.
const ASSET_RE = /\.[a-z0-9]+$/i

// Mirror useDocumentTitle: append " - AstroNote" unless the title already contains the app name.
function pageTitle(docTitle) {
  const base = docTitle && docTitle.trim() ? docTitle.trim() : APP_NAME
  return base.includes(APP_NAME) ? base : `${base} - ${APP_NAME}`
}

// Resolve a document URL → its title, but only for PUBLIC documents. Returns null for anything that
// isn't a public document route (so the caller keeps the default preview). Never throws.
async function resolveDocTitle(url, env) {
  const segs = url.pathname.split('/').filter(Boolean)
  // Document routes are /:project/:doc or /:project/:folder/:doc — at least two segments, where the
  // first is a project slug. Skip project roots, top-level app pages, quick notes, and settings.
  if (segs.length < 2) return null
  if (RESERVED_TOP.has(segs[0])) return null
  if (segs[1] === 'notes') return null // quick notes live in a private workspace
  const docSlug = segs[segs.length - 1]
  if (docSlug === 'settings') return null

  const base = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!base || !key) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const res = await fetch(`${base}/rest/v1/rpc/public_document_title`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ p_project_slug: segs[0], p_doc_slug: docSlug }),
    })
    if (!res.ok) return null
    // A scalar-returning RPC yields the value directly (the title string, or null).
    const title = await res.json()
    return typeof title === 'string' && title.trim() ? title : null
  } catch {
    return null // missing env, network error, timeout — fall back to the default preview
  } finally {
    clearTimeout(timeout)
  }
}

export async function onRequest(context) {
  const { request, next, env } = context
  const url = new URL(request.url)

  // Only rewrite navigations; let assets and non-GET requests through untouched.
  if (request.method !== 'GET' || ASSET_RE.test(url.pathname)) return next()

  const response = await next()
  if (!response.headers.get('content-type')?.includes('text/html')) return response

  const docTitle = await resolveDocTitle(url, env)
  const canonical = url.origin + url.pathname

  let rewriter = new HTMLRewriter()
    .on('meta[property="og:url"]', { element: (el) => el.setAttribute('content', canonical) })

  // Only override the title tags when we actually resolved a (public) document title; otherwise the
  // static "AstroNote" defaults stand.
  if (docTitle) {
    const full = pageTitle(docTitle)
    rewriter = rewriter
      .on('title', { element: (el) => el.setInnerContent(full) })
      .on('meta[property="og:title"]', { element: (el) => el.setAttribute('content', full) })
      .on('meta[name="twitter:title"]', { element: (el) => el.setAttribute('content', full) })
  }

  return rewriter.transform(response)
}
