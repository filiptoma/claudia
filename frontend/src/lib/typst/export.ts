// Browser-only orchestration for the editor's Export ▾ menu: raw .md, standalone .html, and vector
// .pdf (Typst). Markdown projects only. Images referenced as `storage:<path>` (or http/data URLs) are
// resolved to bytes here — rasterized to PNG via canvas so Typst accepts any browser-decodable format
// (webp/avif/gif/…), with SVG kept vector — and handed to the compiler as in-memory shadow files.

import { unified } from 'unified'
import type { Plugin } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import type { Element, Root as HastRoot } from 'hast'
import katexCssRaw from 'katex/dist/katex.min.css?inline'

import { supabase } from '../supabase'
import { STORAGE_PREFIX, extractStoragePaths, signImages } from '../storage'
import { preprocessImageSizes, readSizeFragment } from '../mdImage'
import { parseMarkdown, collectImageSrcs, mdastToTypst } from './mdToTypst'
import { buildTypstDocument, TYPST_COLORS } from './template'
import { compileTypstToPdf } from './compiler'
import type { TypstShadowFile } from './compiler'

// --- image resolution -----------------------------------------------------------------------------

async function blobToTypstImage(blob: Blob): Promise<{ bytes: Uint8Array; ext: string } | null> {
  if (blob.type === 'image/svg+xml') {
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'svg' } // keep vector
  }
  // Rasterize raster formats to PNG so Typst (png/jpg/gif/svg) accepts webp/avif/gif/… uniformly.
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const cx = canvas.getContext('2d')
    if (!cx) throw new Error('no 2d context')
    cx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const out = await canvas.convertToBlob({ type: 'image/png' })
    return { bytes: new Uint8Array(await out.arrayBuffer()), ext: 'png' }
  } catch {
    const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext }
  }
}

async function resolveImageBytes(src: string): Promise<{ bytes: Uint8Array; ext: string } | null> {
  try {
    let blob: Blob
    if (src.startsWith(STORAGE_PREFIX)) {
      const { data, error } = await supabase.storage.from('media').download(src.slice(STORAGE_PREFIX.length))
      if (error || !data) return null
      blob = data
    } else if (/^https?:/i.test(src) || src.startsWith('data:')) {
      const res = await fetch(src)
      if (!res.ok) return null
      blob = await res.blob()
    } else {
      return null // relative/unknown scheme — fall back to alt text in the PDF
    }
    return await blobToTypstImage(blob)
  } catch {
    return null
  }
}

// --- PDF (Typst) ----------------------------------------------------------------------------------

/** Compile a markdown document to a vector PDF (Uint8Array). `title` becomes the PDF metadata title. */
export async function exportMarkdownToPdf(content: string, title: string): Promise<Uint8Array> {
  const source = preprocessImageSizes(content)
  const tree = parseMarkdown(source)
  const srcs = collectImageSrcs(tree)

  const resolved = await Promise.all(srcs.map(async (src) => ({ src, img: await resolveImageBytes(src) })))
  const imagePaths = new Map<string, string>()
  const shadows: TypstShadowFile[] = []
  let n = 0
  for (const { src, img } of resolved) {
    if (!img) continue
    const path = `/img/${n++}.${img.ext}`
    imagePaths.set(src, path)
    shadows.push({ path, bytes: img.bytes })
  }

  const body = mdastToTypst(tree, { imagePaths })
  const doc = buildTypstDocument(body, { title: title || undefined })
  return compileTypstToPdf(doc, shadows)
}

// --- standalone HTML ------------------------------------------------------------------------------

// Self-host nothing for HTML: reference the katex fonts (and the preview fonts) from a CDN so a
// downloaded file renders correctly when online, without bloating it with embedded binaries.
const KATEX_FONT_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/fonts/'
const katexCss = katexCssRaw.replace(/url\(fonts\//g, `url(${KATEX_FONT_CDN}`)

// Rehype step: clean `#mdsize=` hints into width attributes and resolve `storage:` srcs to signed URLs.
function rehypeResolveImages(signed: Record<string, string>): Plugin<[], HastRoot> {
  return () => (tree) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'img') return
      const props = node.properties ?? (node.properties = {})
      const raw = typeof props.src === 'string' ? props.src : ''
      const { src, width } = readSizeFragment(raw)
      props.src = src.startsWith(STORAGE_PREFIX) ? (signed[src.slice(STORAGE_PREFIX.length)] ?? src) : src
      if (width) props.width = width
    })
  }
}

/** Render a markdown document to a single self-contained HTML string (mirrors the on-screen preview). */
export async function renderStandaloneHtml(content: string, title: string): Promise<string> {
  const signed = await signImages(extractStoragePaths(content))
  const source = preprocessImageSizes(content)
  const body = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype)
      .use(rehypeSlug)
      .use(rehypeHighlight, { detect: false, ignoreMissing: true })
      .use(rehypeKatex)
      .use(rehypeResolveImages(signed))
      .use(rehypeStringify)
      .process(source),
  )
  return wrapStandaloneHtml(title, body)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function wrapStandaloneHtml(title: string, body: string): string {
  const c = TYPST_COLORS
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || 'Document')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900&family=JetBrains+Mono:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet">
<style>
${katexCss}
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: ${c.foreground}; }
.md { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 6rem; font-family: "Hanken Grotesk", system-ui, sans-serif; font-size: 1.02rem; line-height: 1.7; word-wrap: break-word; }
.md > :first-child { margin-top: 0; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 { margin: 2.2rem 0 0.7rem; line-height: 1.3; letter-spacing: -0.02em; font-weight: 750; }
.md h1 { font-size: 2.2rem; font-weight: 800; letter-spacing: -0.025em; margin-bottom: 2rem; }
.md h2 { font-size: 1.6rem; padding-bottom: 0.25em; border-bottom: 1px solid ${c.border}; margin-bottom: 1.5rem; }
.md h3 { font-size: 1.32rem; } .md h4 { font-size: 1.12rem; }
.md h5, .md h6 { font-size: 1rem; font-weight: 700; color: ${c.muted}; }
.md p, .md ul, .md ol, .md blockquote, .md pre, .md table { margin: 0 0 1.28rem; }
.md ul, .md ol { padding-left: 1.6em; } .md ul { list-style: disc; } .md ol { list-style: decimal; }
.md a { color: ${c.link}; text-decoration: none; font-weight: 500; } .md a:hover { text-decoration: underline; }
.md strong { font-weight: 800; } .md em { font-style: italic; }
.md :not(pre) > code { font-family: "JetBrains Mono", monospace; font-size: 0.86em; color: ${c.code}; background: ${c.codeChip}; padding: 0.15em 0.4em; border-radius: 5px; }
.md pre { padding: 14px 16px; border-radius: 8px; overflow-x: auto; border: 1px solid ${c.border}; background: ${c.surface}; }
.md pre code { font-family: "JetBrains Mono", monospace; font-size: 0.86rem; line-height: 1.6; }
.md blockquote { padding: 0.6em 1em; border-left: 3px solid ${c.primary}; background: ${c.quote}; border-radius: 0 8px 8px 0; }
.md table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
.md th, .md td { border: 1px solid ${c.border}; padding: 8px 12px; text-align: left; }
.md thead th { background: ${c.surface}; font-weight: 650; }
.md tbody tr:nth-child(even) { background: ${c.zebra}; }
.md img { display: block; max-width: 100%; height: auto; margin: 1.28rem auto; background: #fff; border: 1px solid ${c.plateBorder}; border-radius: 8px; padding: 8px; }
.md hr { border: none; border-top: 1px solid ${c.border}; margin: 1.28rem 0; }
.md .hljs-comment, .md .hljs-quote { color: ${c.muted}; font-style: italic; }
.md .hljs-keyword, .md .hljs-built_in, .md .hljs-name, .md .hljs-tag { color: #b76b1c; }
.md .hljs-string, .md .hljs-attr, .md .hljs-regexp, .md .hljs-addition { color: #428252; }
.md .hljs-number, .md .hljs-literal, .md .hljs-type, .md .hljs-meta, .md .hljs-symbol { color: #c66846; }
.md .hljs-title, .md .hljs-section { color: #4075aa; }
</style>
</head>
<body><div class="md">${body}</div></body>
</html>`
}

// --- raw markdown + download helper ---------------------------------------------------------------

/** Trigger a browser download of in-memory data (string content or raw bytes). */
export function downloadFile(filename: string, data: string | Uint8Array, mime: string): void {
  // Copy bytes into a fresh ArrayBuffer-backed view so the Blob part type is satisfied (the compiler
  // hands back a Uint8Array<ArrayBufferLike>, which the strict BlobPart type rejects directly).
  const part: BlobPart = typeof data === 'string' ? data : new Uint8Array(data)
  const url = URL.createObjectURL(new Blob([part], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A filesystem-safe `<base>.<ext>` from a (possibly empty) document title. */
export function exportFilename(title: string, ext: string): string {
  const base =
    (title || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 100)
      .trim() || 'document'
  return `${base}.${ext}`
}
