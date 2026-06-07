import type { Element, ElementContent, Properties, Root, RootContent, Text } from 'hast'
import type { Plugin } from 'unified'
import { diffSegments } from './diff'

// rehype plugin (annotate mode): render each pending suggestion inline as a Google-Docs-style diff —
// the original and the suggestion interleaved character-by-character (like git): deleted runs inside
// <del>, inserted runs inside <ins>, unchanged runs left as plain text. Styling (strikethrough for
// deletions, indigo border, no colour) lives in CSS.
//
// Ranges are given in *preprocessed* source coordinates (matching the HAST text-node positions). Must
// run BEFORE rehypeSourceSpans so the (re-split) original-text nodes keep their source positions and
// still get wrapped in `.sp` spans — selections over them map back to source as usual; inserted text
// carries no position and is left unwrapped (it isn't part of the saved document yet).

export interface SuggestionRange {
  id: string
  ppStart: number
  ppEnd: number
  suggested: string
}

const SKIP = new Set(['pre', 'code', 'script', 'style'])

function textOffsets(node: Text): { start: number; end: number } | null {
  const p = node.position
  if (!p || typeof p.start?.offset !== 'number' || typeof p.end?.offset !== 'number') return null
  if (p.end.offset <= p.start.offset) return null
  return { start: p.start.offset, end: p.end.offset }
}

interface Hit {
  parent: Root | Element
  index: number
  node: Text
  start: number
  end: number
}

// Collect (in document order) every positioned text node overlapping [ps, pe).
function collectHits(node: Root | Element, ps: number, pe: number, out: Hit[]): void {
  const children = node.children as Array<RootContent | ElementContent>
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.type === 'text') {
      const off = textOffsets(child)
      if (off && off.start < pe && off.end > ps) out.push({ parent: node, index: i, node: child, start: off.start, end: off.end })
    } else if (child.type === 'element' && !SKIP.has(child.tagName)) {
      collectHits(child, ps, pe, out)
    }
  }
}

function textNode(value: string, start: number, end: number): Text {
  return { type: 'text', value, position: { start: { line: 0, column: 0, offset: start }, end: { line: 0, column: 0, offset: end } } }
}

function wrap(tagName: 'del' | 'ins', children: ElementContent[], className: string[], id?: string): Element {
  const properties: Properties = { className }
  if (id) properties.dataSugId = id
  return { type: 'element', tagName, properties, children }
}

const rehypeSuggestionDiff =
  (suggestions: SuggestionRange[]): Plugin<[], Root> =>
  () =>
  (tree: Root) => {
    for (const s of suggestions) {
      if (s.ppEnd <= s.ppStart) continue
      const hits: Hit[] = []
      collectHits(tree, s.ppStart, s.ppEnd, hits)
      if (hits.length === 0) continue

      if (hits.length === 1) {
        // Common case — the whole original lies in one text node. Replace it with
        // [before] <span.sug>…interleaved diff…</span> [after].
        const h = hits[0]
        const a = Math.max(s.ppStart, h.start) - h.start
        const b = Math.min(s.ppEnd, h.end) - h.start
        const val = h.node.value
        const original = val.slice(a, b)

        const inner: ElementContent[] = []
        let oc = 0 // offset within `original`
        for (const seg of diffSegments(original, s.suggested)) {
          if (seg.op === 'insert') {
            inner.push(wrap('ins', [{ type: 'text', value: seg.text }], []))
            continue
          }
          const segStart = h.start + a + oc
          const node = textNode(seg.text, segStart, segStart + seg.text.length)
          inner.push(seg.op === 'delete' ? wrap('del', [node], []) : node)
          oc += seg.text.length
        }

        const out: ElementContent[] = []
        if (a > 0) out.push(textNode(val.slice(0, a), h.start, h.start + a))
        out.push({ type: 'element', tagName: 'span', properties: { className: ['sug'], dataSugId: s.id }, children: inner })
        if (b < val.length) out.push(textNode(val.slice(b), h.start + b, h.end))
        ;(h.parent.children as ElementContent[]).splice(h.index, 1, ...out)
      } else {
        // Rare — the original spans inline formatting (bold, links, …): strike each segment in place
        // and append the whole suggestion after the last. Apply last→first to keep indices valid.
        for (let k = hits.length - 1; k >= 0; k--) {
          const h = hits[k]
          const a = Math.max(s.ppStart, h.start) - h.start
          const b = Math.min(s.ppEnd, h.end) - h.start
          const val = h.node.value
          const out: ElementContent[] = []
          if (a > 0) out.push(textNode(val.slice(0, a), h.start, h.start + a))
          out.push(wrap('del', [textNode(val.slice(a, b), h.start + a, h.start + b)], ['sug-del'], s.id))
          if (k === hits.length - 1) out.push(wrap('ins', [{ type: 'text', value: s.suggested }], ['sug-ins'], s.id))
          if (b < val.length) out.push(textNode(val.slice(b), h.start + b, h.end))
          ;(h.parent.children as ElementContent[]).splice(h.index, 1, ...out)
        }
      }
    }
  }

export default rehypeSuggestionDiff
