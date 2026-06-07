import type { Element, ElementContent, Root, RootContent, Text } from 'hast'
import type { Plugin } from 'unified'

// rehype plugin (annotate mode only): wrap each rendered text run in
//   <span class="sp" data-s="<start>" data-e="<end>">…</span>
// carrying the run's source offsets (in *preprocessed* coordinates — see lib/mdImage). Because a
// text node's rendered text IS its source text, an endpoint's source offset is `data-s` + the
// intra-node offset, which lets a rendered selection be mapped back to an exact markdown range.
//
// Must run LAST in rehypePlugins (after highlight/katex): nodes those plugins synthesize have no
// source `position`, so they're skipped — only original text keeps its offsets. Text inside
// code/pre (and script/style) is skipped so code blocks and math stay untouched.

const SKIP = new Set(['pre', 'code', 'script', 'style'])

// Source offsets of a text node, or null if it has no (or a degenerate) source position — e.g. a
// node synthesized by an earlier rehype plugin, which we must not wrap.
function offsetsOf(node: Text): { start: number; end: number } | null {
  const p = node.position
  if (!p || typeof p.start?.offset !== 'number' || typeof p.end?.offset !== 'number') return null
  if (p.end.offset <= p.start.offset) return null
  return { start: p.start.offset, end: p.end.offset }
}

function wrap(node: Text, start: number, end: number): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['sp'], dataS: start, dataE: end },
    children: [node],
  }
}

function visit(node: Root | Element): void {
  const children = node.children as Array<RootContent | ElementContent>
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.type === 'text') {
      const off = child.value.length > 0 ? offsetsOf(child) : null
      if (off) {
        children[i] = wrap(child, off.start, off.end) as ElementContent
      }
    } else if (child.type === 'element') {
      if (SKIP.has(child.tagName)) continue
      visit(child)
    }
  }
}

const rehypeSourceSpans: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree)
}

export default rehypeSourceSpans
