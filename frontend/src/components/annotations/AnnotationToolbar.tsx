import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/lib/toast'
import { countNormostrana } from '@/lib/normostrana'
import { cn } from '@/lib/utils'

// Nearest scroll container by overflow style (the page scroll area in read mode, the preview pane in
// split) — matched by style alone, not current overflow, so the listener attaches before content grows.
function getScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return node
    node = node.parentElement
  }
  return null
}

// Copies the rendered document's markdown SOURCE to the clipboard, flashing a check for ~1.5s.
function CopyMarkdownButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('error', 'Couldn’t copy to clipboard')
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void onCopy()}
          aria-label="Copy markdown"
          className="gap-1.5 text-muted-foreground"
        >
          {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied!' : 'Copy markdown'}</TooltipContent>
    </Tooltip>
  )
}

// Rendered-text length shown as a "normostrana" (Czech/Slovak standard page = 1 800 characters incl.
// spaces). Counts the stripped prose, not the raw markdown. Memoised so it only recomputes when the
// content changes (the split preview already feeds debounced content).
function NormostranaChip({ content }: { content: string }) {
  const { chars, pages } = useMemo(() => countNormostrana(content), [content])
  const pagesLabel = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pages)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default select-none text-xs font-medium tabular-nums text-muted-foreground">
          {pagesLabel} NS
        </span>
      </TooltipTrigger>
      <TooltipContent>{chars.toLocaleString()} characters incl. spaces · 1 normostrana = 1 800</TooltipContent>
    </Tooltip>
  )
}

/**
 * The toolbar pinned to the top of a rendered-markdown view (read mode, or the split editor's preview
 * pane) — the counterpart of the editor's formatting toolbar, and the SAME component in both places.
 * It holds a "copy markdown" button (always available) and, when commenting is in play, the button
 * that opens the comments & suggestions sidebar, badged with the count of unresolved annotations.
 *
 * It is rendered as the first child INSIDE its scroll container (`sticky top-0`), and auto-hides when
 * the reader scrolls down, reappearing on scroll up — like a typical app bar.
 */
export default function AnnotationToolbar({
  count,
  onOpenSidebar,
  content,
  showComments = true,
  autoHide = true,
  className,
}: {
  count: number
  onOpenSidebar: () => void
  /** The markdown source backing this view — copied verbatim by the copy button. */
  content: string
  /** Show the comments/suggestions sidebar button. Hidden for plain viewers with nothing to read. */
  showComments?: boolean
  /** When true: sticky-inside-its-scroller + auto-hide-on-scroll-down. When false (split editor and read
   *  mode): a fixed bar OUTSIDE the scroll area, always visible, mirroring the editor's formatting
   *  toolbar (and making the scroll viewport start below it). */
  autoHide?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!autoHide) return
    const el = ref.current
    if (!el) return
    const scroller = getScrollParent(el)
    if (!scroller) return
    let last = scroller.scrollTop
    const onScroll = () => {
      const cur = scroller.scrollTop
      if (cur < 8) {
        setHidden(false) // always visible near the top
      } else if (cur - last > 4) {
        setHidden(true) // scrolling down → hide
      } else if (last - cur > 4) {
        setHidden(false) // scrolling up → show
      }
      last = cur
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [autoHide])

  return (
    <div
      ref={ref}
      className={cn(
        'flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-2.5',
        autoHide && 'sticky top-0 z-20 transition-transform duration-200',
        autoHide && hidden && '-translate-y-full',
        className,
      )}
    >
      <NormostranaChip content={content} />
      <div className="flex items-center gap-0.5">
        <CopyMarkdownButton content={content} />
        {showComments && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenSidebar}
            aria-label="Open comments and suggestions"
            className="gap-1.5 text-muted-foreground"
          >
            <MessageSquare className="size-4" />
            {count > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] font-bold leading-none text-primary-foreground">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
