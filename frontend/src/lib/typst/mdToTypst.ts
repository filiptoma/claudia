// Walks the SAME mdast the app renders (remark-parse + remark-gfm + remark-math) and emits Typst
// markup that the Typst preamble in template.ts styles to mirror the on-screen `.md` preview. This is
// the single conversion used for PDF export. Math is LaTeX (KaTeX dialect) in markdown but Typst has
// its own math language, so each `$…$` body is run through `tex2typst` to a Typst math expression.
//
// Self-contained (npm imports only) so it can be unit-/smoke-tested in Node without the app shell.
// Image *resolution* (downloading bytes) happens in export.ts; this walker only references images by a
// virtual memfs path supplied via `imagePaths`, falling back to the alt text when a path is absent.

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { tex2typst } from 'tex2typst'
import GithubSlugger from 'github-slugger'
import type { Root, RootContent, Definition, List } from 'mdast'
import { typstString } from './template'

// remark-math nodes aren't in @types/mdast's RootContent union; model them locally and widen.
interface MathNode {
  type: 'math'
  value: string
}
interface InlineMathNode {
  type: 'inlineMath'
  value: string
}
type MdNode = RootContent | MathNode | InlineMathNode

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath)

/** Parse markdown to an mdast tree (GFM tables/strikethrough + `$…$` math nodes included). */
export function parseMarkdown(content: string): Root {
  return processor.parse(content) as Root
}

/** Every image source referenced by the document, cleaned of any `#mdsize=` hint. */
export function collectImageSrcs(tree: Root): string[] {
  const out = new Set<string>()
  const walk = (nodes: MdNode[]) => {
    for (const n of nodes) {
      if (n.type === 'image') out.add(cleanImageUrl(n.url).url)
      if ('children' in n && Array.isArray(n.children)) walk(n.children as MdNode[])
    }
  }
  walk(tree.children as MdNode[])
  return [...out]
}

export interface MdToTypstOptions {
  /** Maps an image's (cleaned) source to the virtual memfs path its bytes are mapped to (export.ts). */
  imagePaths?: Map<string, string>
}

/** Convert a parsed mdast tree to a Typst markup body (no preamble — see buildTypstDocument). */
export function mdastToTypst(tree: Root, opts: MdToTypstOptions = {}): string {
  const defs = new Map<string, Definition>()
  const collectDefs = (nodes: MdNode[]) => {
    for (const n of nodes) {
      if (n.type === 'definition') defs.set(n.identifier.toLowerCase(), n)
      if ('children' in n && Array.isArray(n.children)) collectDefs(n.children as MdNode[])
    }
  }
  collectDefs(tree.children as MdNode[])
  const ctx: Ctx = {
    imagePaths: opts.imagePaths ?? new Map(),
    defs,
    headingLabels: collectHeadingLabels(tree.children as MdNode[]),
    headingIndex: 0,
  }
  return renderBlocks(tree.children as MdNode[], ctx)
}

interface Ctx {
  imagePaths: Map<string, string>
  defs: Map<string, Definition>
  /** Heading anchor slug → the Typst label attached to that heading (for in-document `#…` jumps). */
  headingLabels: Map<string, string>
  /** Running count of headings emitted; the Nth heading's label is `heading-N` (see collectHeadingLabels). */
  headingIndex: number
}

// --- heading anchors ------------------------------------------------------------------------------

// The preview gives every heading a github-slugger id (via rehype-slug) that `[text](#slug)` links
// jump to. We replay the SAME slugger over the headings in document order to map each anchor slug to
// a stable Typst label (`heading-0`, `heading-1`, …), so renderBlock can attach that label to the
// heading and renderLink can turn `#slug` into a clickable intra-document jump. Index-based label
// names sidestep Typst's label-syntax constraints on arbitrary (possibly unicode) slug text.
function collectHeadingLabels(nodes: MdNode[]): Map<string, string> {
  const slugger = new GithubSlugger()
  const labels = new Map<string, string>()
  let i = 0
  const walk = (ns: MdNode[]) => {
    for (const n of ns) {
      if (n.type === 'heading') {
        labels.set(slugger.slug(headingPlainText(n.children as MdNode[])), `heading-${i++}`)
      } else if ('children' in n && Array.isArray(n.children)) {
        walk(n.children as MdNode[])
      }
    }
  }
  walk(nodes)
  return labels
}

// A heading's slug source: its rendered text content, matching what rehype-slug sees in the preview's
// HAST (text + inline code + math source; images carry no text content, so their alt is excluded).
function headingPlainText(nodes: MdNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text' || n.type === 'inlineCode' || n.type === 'inlineMath') return n.value
      if (n.type === 'image' || n.type === 'imageReference') return ''
      return 'children' in n && Array.isArray(n.children) ? headingPlainText(n.children as MdNode[]) : ''
    })
    .join('')
}

const PX_TO_PT = 0.75
const MAX_IMG_PT = 450

// --- text escaping --------------------------------------------------------------------------------

// Typst markup specials that must be escaped anywhere they appear in literal text. `/` is included
// because `//` and `/*` start Typst comments mid-text (not just at a line start).
function escapeText(s: string): string {
  return s.replace(/[\\#$*_`<>@~[\]/]/g, (c) => '\\' + c)
}

// Neutralize a leading marker that Typst would read as a block element (heading `= `, list `- `/`+ `,
// enum `1. `, comment `//`) when a paragraph of literal text happens to start with one.
function guardBlockStart(s: string): string {
  return s
    .replace(/^(\s*)(\d+)([.)] )/, '$1$2\\$3')
    .replace(/^(\s*)(=+ |[-+] |\/\/)/, '$1\\$2')
}

// --- inline ---------------------------------------------------------------------------------------

function renderInlines(nodes: MdNode[], ctx: Ctx): string {
  return nodes.map((n) => renderInline(n, ctx)).join('')
}

function renderInline(node: MdNode, ctx: Ctx): string {
  switch (node.type) {
    case 'text':
      return escapeText(node.value)
    case 'strong':
      return `#strong[${renderInlines(node.children as MdNode[], ctx)}]`
    case 'emphasis':
      return `#emph[${renderInlines(node.children as MdNode[], ctx)}]`
    case 'delete':
      return `#strike[${renderInlines(node.children as MdNode[], ctx)}]`
    case 'inlineCode':
      return `#raw(${typstString(node.value)})`
    case 'break':
      return `#linebreak()`
    case 'link':
      return renderLink(node.url, renderInlines(node.children as MdNode[], ctx), ctx)
    case 'linkReference': {
      const def = ctx.defs.get(node.identifier.toLowerCase())
      const inner = renderInlines(node.children as MdNode[], ctx)
      return def ? renderLink(def.url, inner, ctx) : inner
    }
    case 'inlineMath':
      return renderMath(node.value, false)
    case 'image':
      return renderInlineImage(node.url, node.alt ?? '', ctx)
    case 'imageReference': {
      const def = ctx.defs.get(node.identifier.toLowerCase())
      return def ? renderInlineImage(def.url, node.alt ?? '', ctx) : escapeText(node.alt ?? '')
    }
    case 'html':
      return '' // raw inline HTML has no Typst equivalent — drop it
    default:
      // Unknown inline node with children → recurse; otherwise ignore.
      return 'children' in node && Array.isArray(node.children) ? renderInlines(node.children as MdNode[], ctx) : ''
  }
}

// Mirror the preview's three link behaviours. Anchor links jump to a heading; internal app routes
// (references to other notes) can't resolve in a standalone PDF, so they render as plain selectable
// text rather than dead links; everything else is a real external link.
function renderLink(url: string, inner: string, ctx: Ctx): string {
  if (url.startsWith('#')) {
    const label = ctx.headingLabels.get(decodeURIComponent(url.slice(1)))
    return label ? `#link(<${label}>)[${inner}]` : inner
  }
  if (url.startsWith('/') && !url.startsWith('//')) return inner
  return `#link(${typstString(url)})[${inner}]`
}

// --- blocks ---------------------------------------------------------------------------------------

function renderBlocks(nodes: MdNode[], ctx: Ctx): string {
  return nodes
    .map((n) => renderBlock(n, ctx))
    .filter((s) => s.length > 0)
    .join('\n\n')
}

function renderBlock(node: MdNode, ctx: Ctx): string {
  switch (node.type) {
    case 'heading': {
      const label = `heading-${ctx.headingIndex++}`
      return `#heading(level: ${node.depth})[${renderInlines(node.children as MdNode[], ctx)}] <${label}>`
    }
    case 'paragraph':
      return renderParagraph(node.children as MdNode[], ctx)
    case 'blockquote':
      return `#blockquote[${renderBlocks(node.children as MdNode[], ctx)}]`
    case 'code':
      return `#raw(${typstString(node.value)}, block: true${node.lang ? `, lang: ${typstString(node.lang)}` : ''})`
    case 'thematicBreak':
      return `#mdhr`
    case 'list':
      return renderList(node, ctx)
    case 'table':
      return renderTable(node, ctx)
    case 'math':
      return renderMath(node.value, true)
    case 'html':
      return ''
    case 'definition':
    case 'footnoteDefinition':
      return '' // resolved inline / unsupported
    default:
      return 'children' in node && Array.isArray(node.children) ? renderBlocks(node.children as MdNode[], ctx) : ''
  }
}

// --- lists ----------------------------------------------------------------------------------------

// Join an item's child blocks the way the `.md` preview's margins do: a block that follows a NESTED
// LIST hugs it (the preview gives `li > ul/ol` margin: 0), while blocks after a paragraph get the
// normal inter-block gap. This keeps a loose-list continuation paragraph grouped with its own item
// instead of drifting halfway to the next one — the prior plain `\n\n` join spaced it like a
// top-level block (par.spacing), so it read as detached / belonging to the following item.
function renderListItemBody(item: MdNode, ctx: Ctx): string {
  if (!('children' in item) || !Array.isArray(item.children)) return ''
  let body = ''
  let prevWasList = false
  for (const child of item.children as MdNode[]) {
    const piece =
      child.type === 'paragraph' ? renderInlines(child.children as MdNode[], ctx) : renderBlock(child, ctx)
    if (piece.length === 0) continue
    if (body.length > 0) body += prevWasList ? '\n#v(0.55em, weak: true)\n' : '\n\n'
    body += piece
    prevWasList = child.type === 'list'
  }
  return body
}

function renderList(node: List, ctx: Ctx): string {
  const items = node.children
  const hasTask = items.some((li) => li.checked === true || li.checked === false)
  if (hasTask) {
    // GFM task list: a borderless stack with drawn checkboxes (no list bullet).
    const lines = items.map((li) => {
      const body = renderListItemBody(li as MdNode, ctx)
      if (li.checked === true || li.checked === false) return `[#taskmark(${li.checked}) ${body}]`
      return `[${body}]`
    })
    return `#block(above: 2.2em, below: 2.2em, stack(dir: ttb, spacing: 1em, ${lines.join(', ')}))`
  }
  const fn = node.ordered ? 'enum' : 'list'
  const items_ = items.map((li) => `[${renderListItemBody(li as MdNode, ctx)}]`)
  const start = node.ordered && typeof node.start === 'number' && node.start !== 1 ? `start: ${node.start}, ` : ''
  // Loose (spread) lists separate items by the inter-block gap, mirroring the preview where loose
  // items carry a paragraph bottom-margin; tight lists fall through to Typst's default line-pitch
  // spacing (= par.leading), matching the preview's `.md li { margin: 0 }`.
  const spacing = node.spread ? 'spacing: 2.2em, ' : ''
  return `#${fn}(${spacing}${start}${items_.join(', ')})`
}

// --- tables ---------------------------------------------------------------------------------------

function renderTable(node: import('mdast').Table, ctx: Ctx): string {
  const aligns = (node.align ?? []).map((a) => (a === 'center' ? 'center' : a === 'right' ? 'right' : 'left'))
  const rows = node.children
  const cols = Math.max(1, ...rows.map((r) => r.children.length))
  const header = rows[0]
  const body = rows.slice(1)
  const headerCells = header
    ? header.children.map((cell) => `text(weight: 650)[${renderInlines(cell.children as MdNode[], ctx)}]`)
    : []
  const bodyRows = body.map(
    (r) => `(${r.children.map((cell) => `[${renderInlines(cell.children as MdNode[], ctx)}]`).join(', ')},)`,
  )
  return `#mdtable(cols: ${cols}, aligns: (${aligns.join(', ')}${aligns.length ? ',' : ''}), header: (${headerCells.join(', ')}${headerCells.length ? ',' : ''}), rows: (${bodyRows.join(', ')}))`
}

// --- math -----------------------------------------------------------------------------------------

function renderMath(latex: string, block: boolean): string {
  let typ: string
  try {
    typ = tex2typst(latex).trim()
  } catch {
    typ = ''
  }
  if (!typ) {
    // Couldn't convert — keep the source visible rather than dropping it.
    return block ? `#raw(${typstString(latex)}, block: true)` : `#raw(${typstString(latex)})`
  }
  return block ? `$\n${typ}\n$` : `$${typ}$`
}

// Every image is a centered block (mirroring the `.md-img-plate` preview, where the block-level
// plate forces a line break — text only ever flows above or below an image, never beside it). So a
// paragraph that mixes text and images is split into separate blocks at each top-level image, the
// same break the HTML plate produces. Images nested inside other inline markup (link/emphasis) are
// rare and stay inline via renderInline's `image` case.
function renderParagraph(children: MdNode[], ctx: Ctx): string {
  const blocks: string[] = []
  let run: MdNode[] = []
  const flushRun = () => {
    if (run.length === 0) return
    const inline = renderInlines(run, ctx)
    if (inline.length > 0) blocks.push(guardBlockStart(inline))
    run = []
  }
  for (const child of children) {
    const img = blockImageFor(child, ctx)
    if (img === null) {
      run.push(child)
      continue
    }
    flushRun()
    if (img.length > 0) blocks.push(img)
  }
  flushRun()
  return blocks.join('\n\n')
}

// A top-level paragraph child that is an image → its centered `#mdimage` markup (or alt-text
// fallback); anything else → null so it stays in the surrounding inline text run.
function blockImageFor(node: MdNode, ctx: Ctx): string | null {
  if (node.type === 'image') return renderBlockImage(node.url, node.alt ?? '', ctx)
  if (node.type === 'imageReference') {
    const def = ctx.defs.get(node.identifier.toLowerCase())
    return def ? renderBlockImage(def.url, node.alt ?? '', ctx) : guardBlockStart(escapeText(node.alt ?? ''))
  }
  return null
}

// --- images ---------------------------------------------------------------------------------------

function cleanImageUrl(url: string): { url: string; width: number | null } {
  const i = url.indexOf('#mdsize=')
  if (i < 0) return { url, width: null }
  const size = url.slice(i + '#mdsize='.length)
  const w = parseInt(size.split('x')[0], 10)
  return { url: url.slice(0, i), width: Number.isFinite(w) && w > 0 ? w : null }
}

function imgWidthPt(px: number): number {
  return Math.min(MAX_IMG_PT, Math.round(px * PX_TO_PT * 100) / 100)
}

function renderBlockImage(rawUrl: string, alt: string, ctx: Ctx): string {
  const { url, width } = cleanImageUrl(rawUrl)
  const path = ctx.imagePaths.get(url)
  if (!path) return alt ? guardBlockStart(escapeText(alt)) : ''
  const widthArg = width ? `, width: ${imgWidthPt(width)}pt` : ''
  return `#mdimage(${typstString(path)}${widthArg})`
}

function renderInlineImage(rawUrl: string, alt: string, ctx: Ctx): string {
  const { url, width } = cleanImageUrl(rawUrl)
  const path = ctx.imagePaths.get(url)
  if (!path) return escapeText(alt)
  const widthArg = width ? `, width: ${imgWidthPt(width)}pt` : ''
  return `#box(image(${typstString(path)}${widthArg}))`
}
