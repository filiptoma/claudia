import type { Mode } from '../components/ModeSwitch'

// Single source of truth for a document's view mode (view | split | edit), shared by the header's
// ModeSwitch and the document body so they can never drift apart.
//
// The URL's `?mode=` is authoritative. When it's absent, unrecognized, or a mode this user/device
// can't use, the mode is **view** — the universal default. (Split is desktop-only; commenters and
// viewers can't edit.) Creation flows that want to open straight into editing pass `?mode=split`
// explicitly in the URL (see paths.ts), so the default only governs links that omit the param.

// Which modes a user may switch between for a document, on this device.
export function availableModesFor(canEdit: boolean, canComment: boolean, isMobile: boolean): Mode[] {
  if (canEdit) return isMobile ? ['view', 'edit'] : ['view', 'split', 'edit']
  if (canComment) return isMobile ? ['view', 'edit'] : ['view', 'split'] // commenters suggest via edit/split
  return ['view']
}

// Resolve the active mode from the URL param, clamped to what's available. When the param is absent or
// unusable, fall back to `fallback` (default 'view'); callers that want a different landing mode pass
// one — e.g. LaTeX opens editors straight into 'split'. 'split' is desktop-only, so on mobile both an
// explicit `?mode=split` and a 'split' fallback degrade to their editing sibling 'edit' (so a "split"
// link or default still opens the editor, not a read-only view).
export function resolveMode(urlMode: string | null, available: Mode[], fallback: Mode = 'view'): Mode {
  if (urlMode && (available as readonly string[]).includes(urlMode)) return urlMode as Mode
  if (urlMode === 'split' && available.includes('edit')) return 'edit'
  // No usable URL mode → fall back, clamped to this device's available modes.
  if (available.includes(fallback)) return fallback
  if (fallback === 'split' && available.includes('edit')) return 'edit'
  return 'view'
}
