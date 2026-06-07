import type { Anchor } from './types'
import { preprocessImageSizesMapped, preprocessedToRaw } from './mdImage'

// Anchoring for inline comments & suggested edits. Two coordinate systems:
//  • Rendered text (root.textContent): where highlights are (re)located, via quote + prefix/suffix —
//    robust to markdown↔HTML differences and small edits.
//  • Source markdown (documents.content): precise ranges for suggestions, captured from the `.sp`
//    spans (lib/sourceSpans) and translated out of preprocessed coordinates (lib/mdImage).

export interface Capture {
  sourceStart: number
  sourceEnd: number
  anchor: Anchor
}

const CONTEXT = 32 // chars of prefix/suffix context kept for disambiguation

// ---- flat (rendered) text offsets ----

/** Flat offset of a (node, offset) boundary within root's rendered text — robust for text or
 *  element boundaries (counts the same text nodes as root.textContent). */
export function flatOffset(root: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange()
  r.selectNodeContents(root)
  try {
    r.setEnd(node, offset)
  } catch {
    return 0
  }
  return r.toString().length
}

interface SpanRec {
  flatStart: number
  flatEnd: number
  s: number // preprocessed source start (data-s)
  e: number // preprocessed source end (data-e)
}

// Index every `.sp` text run with its flat rendered range and its source offsets. O(text nodes).
function buildSpanIndex(root: HTMLElement): SpanRec[] {
  const recs: SpanRec[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let flat = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.nodeValue?.length ?? 0
    const span = n.parentElement
    if (span && span.classList.contains('sp') && span.dataset.s !== undefined && span.dataset.e !== undefined) {
      recs.push({ flatStart: flat, flatEnd: flat + len, s: Number(span.dataset.s), e: Number(span.dataset.e) })
    }
    flat += len
  }
  return recs
}

// Preprocessed source offset for a flat rendered position, or null if it doesn't fall in a `.sp`
// run (e.g. inside a code block / math). On an escape/entity mismatch (rendered length ≠ source
// length) it snaps to the run's source boundary rather than guessing an intra-run offset.
function sourceFromFlat(flat: number, recs: SpanRec[], side: 'start' | 'end'): number | null {
  for (const r of recs) {
    const inside = side === 'start' ? flat >= r.flatStart && flat < r.flatEnd : flat > r.flatStart && flat <= r.flatEnd
    if (inside) {
      if (r.flatEnd - r.flatStart !== r.e - r.s) return side === 'start' ? r.s : r.e
      return r.s + (flat - r.flatStart)
    }
  }
  // Boundary cases: a start at the very end snaps to the last run's end; an end at 0 snaps to first.
  if (recs.length === 0) return null
  if (side === 'start' && flat >= recs[recs.length - 1].flatEnd) return recs[recs.length - 1].e
  if (side === 'end' && flat <= recs[0].flatStart) return recs[0].s
  return null
}

/**
 * Capture a rendered selection as: quote/prefix/suffix (for display re-anchoring) plus a precise
 * raw source range (for suggestions). Returns null for collapsed selections, selections outside
 * `root`, or selections that can't map to source (e.g. inside a code block).
 */
export function captureSelection(root: HTMLElement, range: Range, content: string): Capture | null {
  if (range.collapsed) return null
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const quote = range.toString()
  if (!quote.trim()) return null

  const full = root.textContent ?? ''
  const startFlat = flatOffset(root, range.startContainer, range.startOffset)
  const endFlat = flatOffset(root, range.endContainer, range.endOffset)
  const prefix = full.slice(Math.max(0, startFlat - CONTEXT), startFlat)
  const suffix = full.slice(endFlat, endFlat + CONTEXT)

  const recs = buildSpanIndex(root)
  const ppStart = sourceFromFlat(startFlat, recs, 'start')
  const ppEnd = sourceFromFlat(endFlat, recs, 'end')
  if (ppStart === null || ppEnd === null || ppEnd <= ppStart) return null

  const { map } = preprocessImageSizesMapped(content)
  const sourceStart = preprocessedToRaw(ppStart, map)
  const sourceEnd = preprocessedToRaw(ppEnd, map)
  if (sourceEnd <= sourceStart || sourceStart < 0 || sourceEnd > content.length) return null

  return { sourceStart, sourceEnd, anchor: { quote, prefix, suffix } }
}

// ---- re-anchoring (rendered) ----

function commonSuffixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}
function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

// Locate the text node + offset for a flat position within root.
function locate(root: HTMLElement, flat: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let acc = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.nodeValue?.length ?? 0
    if (flat <= acc + len) return { node: n as Text, offset: flat - acc }
    acc += len
  }
  return null
}

/**
 * Re-locate a stored anchor in the current render by searching for its `quote`, disambiguating
 * multiple matches by prefix/suffix context. Returns a DOM Range, or null when orphaned.
 */
export function resolveAnchor(root: HTMLElement, anchor: Anchor): Range | null {
  const { quote, prefix, suffix } = anchor
  if (!quote) return null
  const full = root.textContent ?? ''

  const candidates: number[] = []
  for (let idx = full.indexOf(quote); idx !== -1; idx = full.indexOf(quote, idx + 1)) candidates.push(idx)
  if (candidates.length === 0) return null

  let best = candidates[0]
  if (candidates.length > 1) {
    let bestScore = -1
    for (const c of candidates) {
      const pre = full.slice(Math.max(0, c - prefix.length), c)
      const suf = full.slice(c + quote.length, c + quote.length + suffix.length)
      const score = commonSuffixLen(pre, prefix) + commonPrefixLen(suf, suffix)
      if (score > bestScore) {
        bestScore = score
        best = c
      }
    }
  }

  const a = locate(root, best)
  const b = locate(root, best + quote.length)
  if (!a || !b) return null
  const range = document.createRange()
  try {
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset)
  } catch {
    return null
  }
  return range
}

// ---- click hit-testing ----

/** Caret (node, offset) at a viewport point, across the standard and the Safari-legacy APIs. */
export function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y)
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null
  }
  const legacy = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (typeof legacy.caretRangeFromPoint === 'function') {
    const r = legacy.caretRangeFromPoint(x, y)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  }
  return null
}

// ---- highlight painting (CSS Custom Highlight API; no DOM mutation) ----

export type HighlightName = 'comment' | 'comment-active' | 'suggestion' | 'suggestion-active'

const NAMES: HighlightName[] = ['comment', 'comment-active', 'suggestion', 'suggestion-active']

export function supportsHighlights(): boolean {
  return typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined'
}

/** Replace the painted highlights with the given range groups (empty/missing groups are cleared). */
export function paintHighlights(groups: Partial<Record<HighlightName, Range[]>>): void {
  if (!supportsHighlights()) return
  for (const name of NAMES) {
    const ranges = groups[name]
    const key = `an-${name}`
    if (ranges && ranges.length) CSS.highlights.set(key, new Highlight(...ranges))
    else CSS.highlights.delete(key)
  }
}

export function clearHighlights(): void {
  if (!supportsHighlights()) return
  for (const name of NAMES) CSS.highlights.delete(`an-${name}`)
}
