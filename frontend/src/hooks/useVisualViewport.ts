import { useEffect, useState } from 'react'

export interface VisualViewportRect {
  /** Height of the visual viewport — i.e. the area NOT covered by the on-screen keyboard. */
  height: number
  /** Offset of the visual viewport's top within the layout viewport (non-zero when the page scrolls). */
  offsetTop: number
  /** True when the visual viewport is meaningfully shorter than the layout viewport (keyboard up). */
  keyboardOpen: boolean
}

// A shrink smaller than this is almost certainly browser chrome (address bar) rather than a keyboard.
const KEYBOARD_THRESHOLD_PX = 150

function readRect(): VisualViewportRect | null {
  const vv = window.visualViewport
  if (!vv) return null
  return {
    height: vv.height,
    offsetTop: vv.offsetTop,
    keyboardOpen: window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX,
  }
}

/**
 * Tracks the visual viewport. `position: fixed` is anchored to the LAYOUT viewport, which
 * iOS/iPadOS/WebKit do NOT shrink when the on-screen keyboard appears — so a vertically-centered fixed
 * modal ends up hidden behind the keyboard. Overlays use this to re-center within the visible area
 * instead. Returns null when the VisualViewport API is unavailable.
 */
export function useVisualViewport(): VisualViewportRect | null {
  const [rect, setRect] = useState<VisualViewportRect | null>(readRect)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setRect(readRect())
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return rect
}
