// Inline @mention token format stored verbatim in comment/suggestion bodies:
//   @[Display Name](mention:<uuid>)
// The resolved uuids are ALSO stored in the row's `mentions[]` (validated fail-closed by a DB
// trigger); this token is what lets us re-render the chip and show the name without a lookup.

const MENTION_RE = /@\[([^\]]+)\]\(mention:([0-9a-fA-F-]{36})\)/g

export interface MentionSegment {
  type: 'mention'
  name: string
  id: string
}
export interface TextSegment {
  type: 'text'
  text: string
}
export type BodySegment = MentionSegment | TextSegment

/** Build a mention token, stripping characters that would break the token grammar from the name. */
export function mentionToken(name: string, id: string): string {
  const safe = name.replace(/[[\]()\n\r]/g, ' ').trim() || 'user'
  return `@[${safe}](mention:${id})`
}

/** Split a body into plain-text and mention segments for rendering. */
export function parseBody(body: string): BodySegment[] {
  const out: BodySegment[] = []
  let last = 0
  // A fresh regex per call (the module-level one carries lastIndex across global matches).
  const re = new RegExp(MENTION_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: body.slice(last, m.index) })
    out.push({ type: 'mention', name: m[1], id: m[2] })
    last = m.index + m[0].length
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) })
  return out
}

/** The unique set of mentioned uuids in a body (what we send as the row's `mentions[]`). */
export function extractMentionIds(body: string): string[] {
  const ids = new Set<string>()
  const re = new RegExp(MENTION_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) ids.add(m[2])
  return [...ids]
}
