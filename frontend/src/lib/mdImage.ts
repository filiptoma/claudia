import type { EditorView } from '@codemirror/view'

// A small engine for image markdown with HackMD-style size hints: `![alt](url =WIDTHx)`.
// The width is stored in the source (so it survives reload and round-trips through both resize
// affordances) and kept aspect-correct by only ever writing the WIDTH — the rendered height
// follows automatically (`height: auto`).
//
// CommonMark does not parse the `=WIDTHx` suffix (the whole image reverts to literal text), so the
// renderer (Markdown.tsx) calls `preprocessImageSizes` first to move the hint into a private URL
// fragment (`#mdsize=…`) that react-markdown does parse and the image component reads back.

export interface ImageToken {
  from: number // absolute offset of the leading `!`
  to: number // absolute offset just past the closing `)`
  alt: string
  url: string // destination only — no size hint, no title
  title?: string // optional "…" title, preserved on rewrite
  width: number | null // explicit width in px, or null when unset
  height: number | null // explicit height in px (rare; preserved but never written by us)
}

export const MIN_IMG_WIDTH = 40
export const MAX_IMG_WIDTH = 4000

// Matches `![alt](url)` with an optional `"title"` and/or a HackMD `=WxH` size hint (either number
// may be omitted). Groups: 1=alt, 2=url, 3=title, 4=width, 5=height. The destination may not contain
// whitespace or `)`. A fresh instance per call avoids shared `lastIndex` state.
const imageRe = () => /!\[([^\]]*)\]\(([^)\s]+)(?:[ \t]+"([^"]*)")?(?:[ \t]+=(\d*)x(\d*))?\)/g

const FENCE_RE = /^\s*(`{3,}|~{3,})/

function toInt(s: string | undefined): number | null {
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

function tokenFromMatch(m: RegExpMatchArray, base: number): ImageToken {
  return {
    from: base + (m.index ?? 0),
    to: base + (m.index ?? 0) + m[0].length,
    alt: m[1] ?? '',
    url: m[2] ?? '',
    title: m[3] || undefined,
    width: toInt(m[4]),
    height: toInt(m[5]),
  }
}

/** Serialize an image token back to markdown, applying `width` (null clears the size hint). */
export function imageMarkdown(
  alt: string,
  url: string,
  title: string | undefined,
  width: number | null,
): string {
  const titlePart = title ? ` "${title}"` : ''
  const sizePart = width && width > 0 ? ` =${Math.round(width)}x` : ''
  return `![${alt}](${url}${titlePart}${sizePart})`
}

/** The image markdown token the cursor is inside, or null. Image syntax is single-line. */
export function parseImageAt(view: EditorView): ImageToken | null {
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const col = head - line.from
  for (const m of line.text.matchAll(imageRe())) {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (col >= start && col <= end) return tokenFromMatch(m, line.from)
  }
  return null
}

export const isInImage = (view: EditorView): boolean => parseImageAt(view) !== null

/** All image tokens in document order, skipping fenced code blocks. Offsets are into `content`. */
export function findImages(content: string): ImageToken[] {
  const out: ImageToken[] = []
  let offset = 0
  let inFence = false
  let fenceChar = ''
  for (const text of content.split('\n')) {
    const fence = text.match(FENCE_RE)
    if (fence) {
      const ch = fence[1][0]
      if (!inFence) {
        inFence = true
        fenceChar = ch
      } else if (ch === fenceChar) {
        inFence = false
      }
    } else if (!inFence) {
      for (const m of text.matchAll(imageRe())) out.push(tokenFromMatch(m, offset))
    }
    offset += text.length + 1
  }
  return out
}

const clampWidth = (w: number) => Math.min(MAX_IMG_WIDTH, Math.max(MIN_IMG_WIDTH, w))

/** Next width for a toolbar +/- step: ±10%, snapped to a tidy multiple of 10, always moving by ≥1px. */
export function stepWidth(current: number, dir: 1 | -1): number {
  const scaled = current * (dir === 1 ? 1.1 : 1 / 1.1)
  let next = Math.round(scaled / 10) * 10
  if (next === Math.round(current)) next = Math.round(current) + dir * 10
  return clampWidth(next)
}

export const clampImageWidth = clampWidth

/**
 * Move HackMD `=WxH` size hints into a private `#mdsize=WxH` URL fragment so react-markdown parses
 * the image (it otherwise rejects the bare `=WxH` suffix and renders the whole thing as text).
 * Fenced code blocks are left untouched so example markdown still displays verbatim.
 */
export function preprocessImageSizes(content: string): string {
  if (!content.includes('=')) return content // fast path: no possible size hint
  let inFence = false
  let fenceChar = ''
  return content
    .split('\n')
    .map((text) => {
      const fence = text.match(FENCE_RE)
      if (fence) {
        const ch = fence[1][0]
        if (!inFence) {
          inFence = true
          fenceChar = ch
        } else if (ch === fenceChar) {
          inFence = false
        }
        return text
      }
      if (inFence) return text
      return text.replace(imageRe(), (full, alt, url, title, w, h) => {
        if (!w && !h) return full
        const titlePart = title ? ` "${title}"` : ''
        return `![${alt}](${url}#mdsize=${w || ''}x${h || ''}${titlePart})`
      })
    })
    .join('\n')
}

/** Read the `#mdsize=WxH` fragment a preprocessed src may carry. Returns the cleaned src + size. */
export function readSizeFragment(src: string): { src: string; width: number | null; height: number | null } {
  const i = src.indexOf('#mdsize=')
  if (i < 0) return { src, width: null, height: null }
  const size = src.slice(i + '#mdsize='.length)
  const [w, h] = size.split('x')
  return { src: src.slice(0, i), width: toInt(w), height: toInt(h) }
}
