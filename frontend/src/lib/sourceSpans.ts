import type { Element, ElementContent, Parents, Text } from 'hast'

// A rehype plugin used only in annotate (view) mode. It wraps every rendered text run in a
// `<span class="sp" data-s=… data-e=…>` carrying that run's offsets into the PREPROCESSED markdown
// source (preserved through the mdast→hast pipeline). Because a text node's rendered text is exactly
// its source text, an endpoint's source offset = the span's data-s + the offset within the node —
// which lets us map a rendered selection back to a precise source range (see lib/anchor.ts).
//
// Text inside <code>/<pre> is left alone: it's syntax-highlighted into its own spans, and we don't
// support anchoring suggestions inside code blocks for v1.

const SKIP = new Set(['code', 'pre'])

function wrap(parent: Parents, index: number, node: Text): void {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number' || node.value.length === 0) return
  const span: Element = {
    type: 'element',
    tagName: 'span',
    properties: { className: ['sp'], dataS: start, dataE: end },
    children: [node],
  }
  ;(parent.children as ElementContent[])[index] = span
}

function visit(node: Parents, inCode: boolean): void {
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    if (child.type === 'element') {
      visit(child, inCode || SKIP.has(child.tagName))
    } else if (child.type === 'text' && !inCode) {
      wrap(node, i, child)
    }
  }
}

export default function rehypeSourceSpans() {
  return (tree: Parents): void => {
    visit(tree, false)
  }
}
