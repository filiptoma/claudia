import { useCallback, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeSlug from 'rehype-slug'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import type { PluggableList } from 'unified'
import 'katex/dist/katex.min.css'
import { STORAGE_PREFIX } from '../lib/storage'
import { preprocessImageSizesMapped, rawToPreprocessed, readSizeFragment } from '../lib/mdImage'
import rehypeSourceSpans from '../lib/sourceSpans'
import rehypeSourceLines from '../lib/sourceLines'
import rehypeSuggestionDiff from '../lib/suggestionDiff'
import type { SuggestionRange } from '../lib/suggestionDiff'
import MdImage from './MdImage'
import ImageLightbox from './ImageLightbox'
import { cn } from '@/lib/utils'

// Nearest actually-scrollable ancestor (the preview pane in split mode, or the page scroll area in
// read mode). Used so anchor jumps scroll that container rather than the whole window.
function getScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

// react-markdown v10: no `inline`/`className` props — wrap in a div, distinguish inline vs fenced
// code in CSS. `storage:<path>` image sources are swapped for signed URLs from the `images` map.
function buildComponents(
  images: Record<string, string>,
  onOpenImage: (src: string, alt: string) => void,
  onToggleTask?: (index: number) => void,
  onResizeImage?: (index: number, width: number) => void,
): Components {
  return {
    img: ({ src, alt }) => {
      // The width hint rides in a private `#mdsize=` fragment (added by preprocessImageSizes); strip
      // it before resolving the storage path, and apply the width (aspect ratio kept via height:auto).
      const { src: cleaned, width } = readSizeFragment(typeof src === 'string' ? src : '')
      let resolved = cleaned
      if (resolved.startsWith(STORAGE_PREFIX)) resolved = images[resolved.slice(STORAGE_PREFIX.length)] ?? ''
      return (
        <MdImage
          src={resolved}
          alt={typeof alt === 'string' ? alt : ''}
          width={width}
          resizable={!!onResizeImage}
          onResize={onResizeImage}
          onOpen={onOpenImage}
        />
      )
    },
    table: ({ node, ...props }) => (
      <div className="md-table-wrap">
        <table {...props} />
      </div>
    ),
    // GFM task-list checkboxes render disabled by default. When an onToggleTask handler is supplied
    // (the editor preview), enable them and report which checkbox (in document order) was toggled so
    // the editor can flip the matching `- [ ]` in the source.
    input: ({ node, ...props }) => {
      if (props.type === 'checkbox' && onToggleTask) {
        return (
          <input
            {...props}
            disabled={false}
            onChange={(e) => {
              const root = e.currentTarget.closest('.md')
              if (!root) return
              const boxes = Array.from(root.querySelectorAll('input[type="checkbox"]'))
              onToggleTask(boxes.indexOf(e.currentTarget))
            }}
          />
        )
      }
      return <input {...props} />
    },
    // External links open in a new tab; internal (`/…`) and anchor (`#…`) links are handled by the
    // delegated click handler on the `.md` wrapper (see below).
    a: ({ node, href, ...props }) => {
      const external = !!href && /^https?:\/\//i.test(href)
      return (
        <a href={href} {...props} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} />
      )
    },
  }
}

// Keep react-markdown's URL sanitization, but let our custom `storage:<path>` image scheme through
// (the default transform would otherwise blank it out, leaving a broken image showing its alt text).
function urlTransform(url: string): string {
  return url.startsWith(STORAGE_PREFIX) ? url : defaultUrlTransform(url)
}

export default function Markdown({
  children,
  images = {},
  className,
  onToggleTask,
  onResizeImage,
  scrollRoot,
  annotate = false,
  sourceLines = false,
  suggestions,
}: {
  children: string
  images?: Record<string, string>
  className?: string
  /** When provided, task-list checkboxes become interactive (used by the editor preview). */
  onToggleTask?: (index: number) => void
  /** When provided, images gain hover resize handles whose result is written back to the source
   *  (the editor's split-mode preview). `index` is the image's document order. */
  onResizeImage?: (index: number, width: number) => void
  /** The scrollable container for in-page `#` anchor jumps. If omitted, the nearest scrollable
   *  ancestor is used. Passing it explicitly (the editor's preview pane) avoids any ambiguity. */
  scrollRoot?: () => HTMLElement | null
  /** When set (view-mode annotation layer), wrap each text run in `<span class="sp" data-s data-e>`
   *  carrying its source offsets, so rendered selections can be mapped back to the markdown. */
  annotate?: boolean
  /** When set (split-mode preview), stamp each rendered block with `data-startline`/`data-endline`
   *  so the editor↔preview scroll sync can map rendered pixels back to source lines. */
  sourceLines?: boolean
  /** Pending suggested edits to render inline as a diff (requires `annotate`). Offsets are raw
   *  `content` coordinates; they're translated to the rendered (preprocessed) space here. */
  suggestions?: { id: string; sourceStart: number; sourceEnd: number; suggested: string }[]
}) {
  const navigate = useNavigate()
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const openLightbox = useCallback((src: string, alt: string) => {
    if (src) setLightbox({ src, alt })
  }, [])
  const components = useMemo(
    () => buildComponents(images, openLightbox, onToggleTask, onResizeImage),
    [images, openLightbox, onToggleTask, onResizeImage],
  )

  // Preprocess HackMD `=WIDTHx` size hints into a parseable URL fragment before rendering; the map
  // lets us translate suggestion ranges (raw coords) into the preprocessed space the HAST uses.
  const { text: source, map } = useMemo(() => preprocessImageSizesMapped(children), [children])

  const ppSuggestions = useMemo<SuggestionRange[]>(
    () =>
      annotate && suggestions
        ? suggestions.map((s) => ({
            id: s.id,
            ppStart: rawToPreprocessed(s.sourceStart, map),
            ppEnd: rawToPreprocessed(s.sourceEnd, map),
            suggested: s.suggested,
          }))
        : [],
    [annotate, suggestions, map],
  )

  // Base rehype pipeline; in annotate mode, render suggestion diffs then stamp source offsets onto
  // text runs LAST (after highlight/katex) so only original, position-bearing text gets wrapped.
  const rehypePlugins = useMemo<PluggableList>(() => {
    // rehypeSourceLines runs first (on pristine positions) so block line-stamps survive highlight/katex.
    const base: PluggableList = [
      ...(sourceLines ? [rehypeSourceLines] : []),
      rehypeSlug,
      [rehypeHighlight, { detect: false, ignoreMissing: true }],
      rehypeKatex,
    ]
    if (!annotate) return base
    return ppSuggestions.length > 0
      ? [...base, rehypeSuggestionDiff(ppSuggestions), rehypeSourceSpans]
      : [...base, rehypeSourceSpans]
  }, [annotate, ppSuggestions, sourceLines])

  // Delegated link handling on the wrapper (robust regardless of how react-markdown renders anchors):
  //  • `#slug`  → scroll that heading to the top of its OWN scroll container (the preview/read panel),
  //              not via scrollIntoView (which would also nudge the whole page) + reflect it in the URL.
  //  • `/path`  → SPA navigation (no full reload). External links keep their default new-tab behavior.
  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (href.startsWith('#')) {
        e.preventDefault()
        const id = decodeURIComponent(href.slice(1))
        if (!id) return
        const root = e.currentTarget
        const target = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ?? document.getElementById(id)
        if (!target) return
        // Prefer the explicit container, but only if it actually scrolls; otherwise find the real one.
        const explicit = scrollRoot?.()
        const scroller =
          explicit && explicit.scrollHeight > explicit.clientHeight + 1 ? explicit : getScrollParent(target)
        if (scroller) {
          const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
          scroller.scrollTo({ top: scroller.scrollTop + delta - 16 })
        } else {
          target.scrollIntoView({ block: 'start' })
        }
        try {
          const url = new URL(window.location.href)
          url.hash = id
          window.history.replaceState(null, '', url) // reflect the anchor without a router navigation
        } catch {
          /* ignore */
        }
      } else if (href.startsWith('/') && !href.startsWith('//')) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        navigate(href)
      }
    },
    [navigate, scrollRoot],
  )

  return (
    <div className={cn('md', className)} onClick={onClick}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // detect:false → fenced blocks without a language stay plain text (no mis-highlighting);
        // only blocks with an explicit, known language get colored. In annotate mode a final plugin
        // wraps text runs in `.sp` spans carrying source offsets (see rehypePlugins above).
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}
