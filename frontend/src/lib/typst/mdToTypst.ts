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
  const ctx: Ctx = { imagePaths: opts.imagePaths ?? new Map(), defs }
  return renderBlocks(tree.children as MdNode[], ctx)
}

interface Ctx {
  imagePaths: Map<string, string>
  defs: Map<string, Definition>
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
      return `#link(${typstString(node.url)})[${renderInlines(node.children as MdNode[], ctx)}]`
    case 'linkReference': {
      const def = ctx.defs.get(node.identifier.toLowerCase())
      const inner = renderInlines(node.children as MdNode[], ctx)
      return def ? `#link(${typstString(def.url)})[${inner}]` : inner
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

// --- blocks ---------------------------------------------------------------------------------------

function renderBlocks(nodes: MdNode[], ctx: Ctx): string {
  return nodes
    .map((n) => renderBlock(n, ctx))
    .filter((s) => s.length > 0)
    .join('\n\n')
}

function renderBlock(node: MdNode, ctx: Ctx): string {
  switch (node.type) {
    case 'heading':
      return `#heading(level: ${node.depth})[${renderInlines(node.children as MdNode[], ctx)}]`
    case 'paragraph': {
      const children = node.children as MdNode[]
      // A lone image is a block-level figure (matches the .md-img-plate centered block).
      if (children.length === 1 && children[0].type === 'image') {
        return renderBlockImage(children[0].url, children[0].alt ?? '', ctx)
      }
      return guardBlockStart(renderInlines(children, ctx))
    }
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

function renderListItemBody(item: MdNode, ctx: Ctx): string {
  if (!('children' in item) || !Array.isArray(item.children)) return ''
  const parts = (item.children as MdNode[]).map((child) =>
    child.type === 'paragraph' ? renderInlines(child.children as MdNode[], ctx) : renderBlock(child, ctx),
  )
  return parts.filter((s) => s.length > 0).join('\n\n')
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
  return `#${fn}(${start}${items_.join(', ')})`
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
