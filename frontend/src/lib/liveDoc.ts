// A single-slot registry for the currently-open document's live (possibly-unsaved) markdown source.
// The markdown editor registers its content getter here on mount; the app-bar Export menu reads it so
// an export triggered from the header reflects the same in-flight edits the editor's own export used to
// (autosave only persists 800 ms after the last keystroke, so the query cache can lag). Exactly one
// editor is mounted at a time, so a single slot — keyed by doc id to reject a stale getter — suffices.
let slot: { docId: string; get: () => string } | null = null

/** Editor registers its live content getter; returns a cleanup that clears the slot on unmount. */
export function registerLiveDoc(docId: string, get: () => string): () => void {
  slot = { docId, get }
  return () => {
    if (slot?.docId === docId) slot = null
  }
}

/** Live content for `docId` if its editor is currently mounted, else null (fall back to saved content). */
export function readLiveDoc(docId: string): string | null {
  return slot?.docId === docId ? slot.get() : null
}
