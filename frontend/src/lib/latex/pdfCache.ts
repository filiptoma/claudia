// Persists the last successfully-compiled PDF per LaTeX project so reopening or reloading a project can
// show that PDF INSTANTLY (with a "recompiling" veil) instead of a blank wait while the engine cold-boots
// (~7 s) and recompiles. Uses the browser's Cache Storage — it stores binary Responses natively, survives
// reloads AND hard reloads, and needs no dependency. Engine-agnostic: keyed by project id, it doesn't care
// which TeX engine produced the bytes (so it survives a future texlyre→MIT-busytex swap, §3.14).

const CACHE_NAME = 'astronote-latex-pdf-v1'
// Synthetic, never-fetched request URLs used purely as cache keys (same-origin, under a reserved path).
const keyFor = (projectId: string) => `/__latex_pdf_cache__/${encodeURIComponent(projectId)}`

export interface CachedPdf {
  pdf: Uint8Array
  /** Whether the cached PDF came from a fast draft (refs/citations may be unresolved). */
  draft: boolean
  /** Epoch ms when it was compiled. */
  compiledAt: number
  /** Signature of the project content this PDF was built from — used to decide whether a reopen needs to
   *  recompile (sig unchanged → the cached PDF is current → skip the expensive compile). */
  sig: string
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

/** Store (overwrite) the latest good PDF for a project. Fire-and-forget; failures are swallowed. */
export async function savePdf(
  projectId: string,
  pdf: Uint8Array,
  meta: { draft: boolean; compiledAt: number; sig: string },
): Promise<void> {
  const cache = await openCache()
  if (!cache) return
  try {
    // Copy into a fresh ArrayBuffer-backed array so the Blob part is typed concretely (TS's Uint8Array
    // is generic over ArrayBufferLike, which BlobPart rejects).
    const res = new Response(new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), {
      headers: {
        'content-type': 'application/pdf',
        'x-draft': meta.draft ? '1' : '0',
        'x-compiled-at': String(meta.compiledAt),
        'x-sig': meta.sig,
      },
    })
    await cache.put(keyFor(projectId), res)
    if (import.meta.env.DEV) console.debug('[latex] PDF cached', pdf.byteLength, 'bytes')
  } catch (err) {
    // Quota exceeded / serialization failure → skip caching; the compile itself is unaffected.
    if (import.meta.env.DEV) console.warn('[latex] PDF cache write FAILED', err)
  }
}

/** Delete every cached PDF — called on logout so a user's compiled output doesn't linger on a shared
 *  device. (The engine ASSET cache is intentionally left intact: it isn't user data and is costly to
 *  re-download.) */
export async function clearPdfCache(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    await caches.delete(CACHE_NAME)
  } catch {
    // ignore
  }
}

/** Load the last cached PDF for a project, or null if none / unavailable. */
export async function loadPdf(projectId: string): Promise<CachedPdf | null> {
  const cache = await openCache()
  if (!cache) return null
  try {
    const res = await cache.match(keyFor(projectId))
    if (!res) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0) return null
    return {
      pdf: new Uint8Array(buf),
      draft: res.headers.get('x-draft') === '1',
      compiledAt: Number(res.headers.get('x-compiled-at')) || 0,
      sig: res.headers.get('x-sig') ?? '',
    }
  } catch {
    return null
  }
}
