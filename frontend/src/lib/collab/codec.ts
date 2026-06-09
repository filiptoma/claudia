// Byte codecs for moving Yjs binary across the two transports co-editing uses.
//
//  - Postgres `bytea` (the canonical `document_collab.ydoc` column), reached over PostgREST, which
//    serialises bytea as the default hex format `\x<hexdigits>`. Used for the initial load and the
//    leader's persistence.
//  - Supabase broadcast, whose payloads are JSON, so binary travels base64-encoded. Used for the live
//    incremental edit/awareness messages (kept tiny by batching/throttling upstream).

// ---- Postgres bytea hex ----

/** Encode bytes as a Postgres `bytea` hex literal (`\x..`) for INSERT/UPDATE via PostgREST. */
export function bytesToPgHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return '\\x' + hex
}

/** Decode a Postgres `bytea` value as returned by PostgREST (hex format, `\x..`) back to bytes. */
export function pgHexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('\\x') ? hex.slice(2) : hex
  const out = new Uint8Array(h.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

// ---- base64 (browser) ----

/** Encode bytes as base64, chunked so a large array can't overflow the call stack in String.fromCharCode. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** Decode a base64 string (a broadcast payload) back to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
