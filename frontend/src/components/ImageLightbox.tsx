import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ZoomIn, ZoomOut, RotateCcw, X } from 'lucide-react'

const MIN_SCALE = 0.2
const MAX_SCALE = 8
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// A full-bleed, zoomable image viewer (HackMD-style). Built on the Radix Dialog primitives for the
// portal, focus trap, scroll lock and Escape-to-close; styled transparent so the image fills the
// screen. Wheel and the +/- buttons zoom; dragging pans once zoomed in.
export default function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => {
      const next = clamp(+(s + delta).toFixed(2), MIN_SCALE, MAX_SCALE)
      if (next <= 1) setOffset({ x: 0, y: 0 }) // recenter when back to fit
      return next
    })
  }, [])

  // Native (non-passive) wheel listener so we can preventDefault and stop the page from scrolling.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 0.2 : -0.2)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (scale <= 1) return
    e.stopPropagation()
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    const d = drag.current
    if (!d) return
    setOffset({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) })
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          onClick={onClose}
          className="fixed inset-0 z-[100] flex touch-none items-center justify-center overflow-hidden outline-none select-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">{alt || 'Image preview'}</DialogPrimitive.Title>
          <img
            src={src}
            alt={alt}
            draggable={false}
            onClick={stop}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transition: dragging ? 'none' : 'transform 140ms ease',
              cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'auto',
            }}
            className="max-h-[92vh] max-w-[94vw] rounded-md shadow-2xl"
          />

          {/* Zoom controls */}
          <div
            onClick={stop}
            className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/90 px-1.5 py-1 text-foreground shadow-lg backdrop-blur"
          >
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => zoomBy(-0.25)}
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4"
            >
              <ZoomOut />
            </button>
            <span className="min-w-12 text-center text-xs font-medium tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => zoomBy(0.25)}
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4"
            >
              <ZoomIn />
            </button>
            <span className="mx-0.5 h-5 w-px bg-border" />
            <button
              type="button"
              aria-label="Reset zoom"
              onClick={reset}
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4"
            >
              <RotateCcw />
            </button>
          </div>

          {/* Close */}
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute top-4 right-4 inline-flex size-9 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4.5"
          >
            <X />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
