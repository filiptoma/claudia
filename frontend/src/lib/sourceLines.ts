import type { Element, Root } from 'hast'
import type { Plugin } from 'unified'

// rehype plugin (split-preview only): stamp each rendered block element with its source line range as
//   data-startline="<1-based start>" data-endline="<1-based end>"
// This is the AstroNote equivalent of HackMD's `.part[data-startline]` blocks. The split editor's
// scroll-sync reads these to build a source-line → preview-pixel map, so the same content stays at the
// top of both panes (line-anchored sync, not a fragile scrollTop/scrollHeight ratio).
//
// Line numbers come straight from the mdast/hast `position` (which react-markdown preserves — the same
// data lib/sourceSpans relies on). Image-size preprocessing only rewrites text *within* a line, never
// adds/removes lines, so these line numbers line up 1:1 with the CodeMirror source.

// Block-level tags whose vertical position is a meaningful scroll anchor. Inline tags (em, strong, a,
// code spans) are skipped: their offsetTop just echoes the enclosing block and would only add noise.
const BLOCK = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'blockquote', 'ul', 'ol', 'li', 'pre', 'table', 'hr',
])

// Don't descend into code/math/raw subtrees: their inner nodes are never useful anchors, and a huge
// fenced block would be a lot of pointless walking.
const SKIP = new Set(['pre', 'code', 'script', 'style'])

function visit(node: Root | Element): void {
  for (const child of node.children) {
    if (child.type !== 'element') continue
    const pos = child.position
    if (BLOCK.has(child.tagName) && pos && typeof pos.start?.line === 'number') {
      const props = (child.properties ??= {})
      // Keep the topmost element per line: a parent block (set first, in document order) wins over a
      // child that starts on the same line, which keeps the map's pixel offsets monotonic.
      if (props.dataStartline === undefined) {
        props.dataStartline = pos.start.line
        props.dataEndline = pos.end?.line ?? pos.start.line
      }
    }
    if (!SKIP.has(child.tagName)) visit(child)
  }
}

const rehypeSourceLines: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree)
}

export default rehypeSourceLines
