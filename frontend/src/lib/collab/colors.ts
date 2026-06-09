// Remote co-editor caret/selection colours, one per user, deterministic from uid so a person's cursor
// hue matches their avatar hue. These are the hex equivalents of ProfileAvatar's Tailwind `*-500`
// swatches, in the SAME order and indexed the SAME way (charCodeAt(0) % 8) — awareness needs a real CSS
// colour, which a Tailwind class name isn't. Keep this list in sync with ProfileAvatar's BG_COLORS.
const HUES = [
  '#8b5cf6', // violet-500
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#f43f5e', // rose-500
  '#06b6d4', // cyan-500
  '#d946ef', // fuchsia-500
  '#f97316', // orange-500
]

/** Solid caret colour for a user. */
export function userColor(uid: string): string {
  return HUES[(uid.charCodeAt(0) || 0) % HUES.length]
}

/** Translucent selection-highlight colour (same hue, ~20% alpha). */
export function userColorLight(uid: string): string {
  return userColor(uid) + '33'
}
