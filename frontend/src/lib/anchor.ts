import { preprocessImageSizesMapped, preprocessedToRaw } from './mdImage'
import type { Anchor } from './types'

// Anchoring for inline comments & suggestions over rendered markdown (see lib/sourceSpans.ts).
//
// Two coordinate systems are in play:
//   • RENDERED TEXT  — root.textContent. The highlight is (re)located here via the quote + context
//     selectors (TextQuoteSelector), so display survives the markdown→HTML difference and minor edits.
//   • SOURCE MARKDOWN — offsets into documents.content. Captured from the `.sp` spans (which carry
//     PREPROCESSED offsets) and translated back to raw content, so a suggestion can be spliced in.

const CONTEXT = 32 // chars of prefix/suffix kept for disambiguation / fuzzy re-anchoring

// ---------- rendered-text helpers ----------

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const out: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text)
  return out
}

interface NodeIndex {
  text: string
  nodes: { node: Text; start: number }[]
}

function indexText(root: HTMLElement): NodeIndex {
  const nodes: { node: Text; start: number }[] = []
  let text = ''
  for (const node of textNodes(root)) {
    nodes.push({ node, start: text.length })
    text += node.data
  }
  return { text, nodes }
}

// Flat character offset (into root.textContent) of a DOM boundary — robust whether the boundary is a
// text node or an element, via Range string length.
function flatOffset(root: HTMLElement, container: Node, offset: number): number {
  const r = document.createRange()
  r.selectNodeContents(root)
  try {
    r.setEnd(container, offset)
  } catch {
    return 0
  }
  return r.toString().length
}

// Flat offset -> DOM position, for building a Range from stored selectors.
function locate(idx: NodeIndex, offset: number): { node: Text; offset: number } | null {
  for (const { node, start } of idx.nodes) {
    if (offset <= start + node.data.length) return { node, offset: Math.max(0, offset - start) }
  }
  const last = idx.nodes[idx.nodes.length - 1]
  return last ? { node: last.node, offset: last.node.data.length } : null
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}
function commonSuffixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

// Pick the occurrence of `quote` whose surrounding text best matches the stored prefix/suffix.
function bestMatch(full: string, anchor: Anchor): number {
  const { quote, prefix, suffix } = anchor
  if (!quote) return -1
  let from = 0
  let best = -1
  let bestScore = -1
  for (;;) {
    const idx = full.indexOf(quote, from)
    if (idx < 0) break
    const before = full.slice(Math.max(0, idx - prefix.length), idx)
    const after = full.slice(idx + quote.length, idx + quote.length + suffix.length)
    const score = commonSuffixLen(before, prefix) + commonPrefixLen(after, suffix)
    if (score > bestScore) {
      bestScore = score
      best = idx
    }
    from = idx + 1
  }
  return best
}

// ---------- source-offset helpers ----------

// Source offset of a selection endpoint, read from its enclosing `.sp` span. `end=true` snaps to the
// span's end when an exact intra-node mapping isn't safe (escapes/entities make node length differ).
function spanOffset(container: Node, offset: number, end: boolean): number | null {
  const el = container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as Element)
  const sp = el?.closest('span.sp')
  if (!(sp instanceof HTMLElement)) return null
  const s = Number(sp.dataset.s)
  const e = Number(sp.dataset.e)
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null
  const first = sp.firstChild
  const nodeLen = first && first.nodeType === Node.TEXT_NODE ? (first as Text).data.length : -1
  if (container.nodeType === Node.TEXT_NODE && e - s === nodeLen) return s + offset
  return end ? e : s
}

function sourceRange(range: Range, content: string): { start: number; end: number } | null {
  const startPp = spanOffset(range.startContainer, range.startOffset, false)
  const endPp = spanOffset(range.endContainer, range.endOffset, true)
  if (startPp === null || endPp === null) return null
  const { map } = preprocessImageSizesMapped(content)
  let start = preprocessedToRaw(startPp, map)
  let end = preprocessedToRaw(endPp, map)
  if (end < start) [start, end] = [end, start]
  if (end <= start) return null
  return { start, end }
}

// ---------- public API ----------

export interface Capture {
  sourceStart: number
  sourceEnd: number
  anchor: Anchor
}

// Capture a user selection as a stored anchor + precise source range. Returns null when the selection
// is empty/collapsed or can't be mapped to the source (e.g. inside a code block).
export function captureSelection(root: HTMLElement, range: Range, content: string): Capture | null {
  if (range.collapsed) return null
  const full = root.textContent ?? ''
  const startFlat = flatOffset(root, range.startContainer, range.startOffset)
  const endFlat = flatOffset(root, range.endContainer, range.endOffset)
  const [a, b] = startFlat <= endFlat ? [startFlat, endFlat] : [endFlat, startFlat]
  const quote = full.slice(a, b)
  if (!quote.trim()) return null
  const src = sourceRange(range, content)
  if (!src) return null
  return {
    sourceStart: src.start,
    sourceEnd: src.end,
    anchor: {
      quote,
      prefix: full.slice(Math.max(0, a - CONTEXT), a),
      suffix: full.slice(b, b + CONTEXT),
    },
  }
}

// Re-locate a stored anchor in the current rendered DOM. Returns null when the text no longer matches
// (the annotation is "orphaned").
export function resolveAnchor(root: HTMLElement, anchor: Anchor): Range | null {
  const idx = indexText(root)
  const at = bestMatch(idx.text, anchor)
  if (at < 0) return null
  const a = locate(idx, at)
  const b = locate(idx, at + anchor.quote.length)
  if (!a || !b) return null
  const r = document.createRange()
  r.setStart(a.node, a.offset)
  r.setEnd(b.node, b.offset)
  return r
}

// The DOM caret at a viewport point, used to hit-test clicks against highlight ranges.
export function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
  if ('caretPositionFromPoint' in document) {
    const pos = document.caretPositionFromPoint(x, y)
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null
  }
  if ('caretRangeFromPoint' in document) {
    const r = document.caretRangeFromPoint(x, y)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  }
  return null
}

// ---------- CSS Custom Highlight API painting (no DOM mutation) ----------

export type HighlightName = 'comment' | 'comment-active' | 'suggestion' | 'suggestion-active'
const ALL_NAMES: HighlightName[] = ['comment', 'comment-active', 'suggestion', 'suggestion-active']

export function supportsHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

export function paintHighlights(groups: Partial<Record<HighlightName, Range[]>>): void {
  if (!supportsHighlights()) return
  for (const name of ALL_NAMES) {
    const ranges = groups[name]
    if (!ranges || ranges.length === 0) CSS.highlights.delete(name)
    else CSS.highlights.set(name, new Highlight(...ranges))
  }
}

export function clearHighlights(): void {
  if (!supportsHighlights()) return
  for (const name of ALL_NAMES) CSS.highlights.delete(name)
}
