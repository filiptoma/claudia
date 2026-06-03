import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Scaling } from 'lucide-react'
import { clampImageWidth } from '../lib/mdImage'
import { cn } from '@/lib/utils'

// A rendered markdown image. Clicking it opens the zoom lightbox (all modes). In the split-mode
// preview (`resizable`), hovering reveals a button that toggles a bottom-right resize handle; dragging
// it changes the width live and, on release, writes the new width back into the markdown source
// (aspect ratio is preserved because only the width is set — height stays `auto`).
export default function MdImage({
  src,
  alt,
  width,
  resizable,
  onResize,
  onOpen,
}: {
  src: string
  alt: string
  width: number | null
  resizable: boolean
  /** Commit a new width for the Nth image (document order) back to the source. */
  onResize?: (index: number, width: number) => void
  onOpen: (src: string, alt: string) => void
}) {
  const plateRef = useRef<HTMLSpanElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [resizeMode, setResizeMode] = useState(false)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const drag = useRef<{ startX: number; startW: number; maxW: number; cur: number } | null>(null)

  // Once a committed resize round-trips back through the source (the `width` prop updates ~150ms
  // later), drop the transient drag width so the prop becomes authoritative again — without keeping it
  // across that gap the image would flash back to its old size between pointer-up and the re-render.
  // Reset during render (not an effect) when the prop changes — the same pattern as DocumentBody.
  const [prevWidth, setPrevWidth] = useState(width)
  if (prevWidth !== width) {
    setPrevWidth(width)
    if (dragWidth !== null) setDragWidth(null)
  }

  // Leave resize mode when the user clicks anywhere outside this image.
  useEffect(() => {
    if (!resizeMode) return
    const onDown = (e: PointerEvent) => {
      if (!plateRef.current?.contains(e.target as Node)) setResizeMode(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [resizeMode])

  const displayWidth = dragWidth ?? width ?? undefined

  // This image's position among all rendered images, read from the DOM at commit time (same approach
  // as the task-list checkboxes) so it lines up with findImages() over the source.
  const imageIndex = (): number => {
    const root = plateRef.current?.closest('.md')
    if (!root || !imgRef.current) return -1
    return Array.from(root.querySelectorAll('img')).indexOf(imgRef.current)
  }

  const onHandleDown = (e: ReactPointerEvent) => {
    const img = imgRef.current
    if (!img) return
    e.preventDefault()
    e.stopPropagation()
    const maxW = plateRef.current?.parentElement?.clientWidth ?? 4000
    const startW = img.clientWidth
    drag.current = { startX: e.clientX, startW, maxW, cur: startW }
    setDragWidth(startW)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onHandleMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const next = clampImageWidth(Math.min(d.maxW, d.startW + (e.clientX - d.startX)))
    d.cur = next
    setDragWidth(next)
  }
  const onHandleUp = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    // Keep dragWidth until the committed width round-trips back via the `width` prop (see effect above).
    const idx = imageIndex()
    if (idx >= 0) onResize?.(idx, Math.round(d.cur))
  }

  return (
    <span ref={plateRef} className={cn('md-img-plate group', resizeMode && 'md-img-plate--resizing')}>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        onClick={() => onOpen(src, alt)}
        style={displayWidth ? { width: displayWidth } : undefined}
        className={cn('cursor-zoom-in', resizeMode && 'rounded-[3px] ring-2 ring-primary/60')}
      />
      {resizable && (
        <>
          <button
            type="button"
            aria-label="Resize image"
            onClick={(e) => {
              e.stopPropagation()
              setResizeMode((v) => !v)
            }}
            className={cn(
              'absolute top-2 right-2 z-10 inline-flex size-7 items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 hover:text-foreground [&_svg]:size-4',
              resizeMode && 'border-primary/50 text-foreground opacity-100',
            )}
          >
            <Scaling />
          </button>
          {resizeMode && (
            <span
              role="slider"
              aria-label="Drag to resize"
              aria-valuenow={displayWidth ? Math.round(displayWidth) : undefined}
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              className="absolute right-1 bottom-1 z-10 size-3.5 cursor-nwse-resize rounded-sm border-2 border-primary bg-card shadow"
            />
          )}
        </>
      )}
    </span>
  )
}
