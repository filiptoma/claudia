import { useEffect } from 'react'

// A shrink smaller than this is almost certainly browser chrome (address bar) rather than a keyboard.
// Kept in sync with useVisualViewport's threshold.
const KEYBOARD_THRESHOLD_PX = 150

/**
 * iOS/iPadOS — most visibly in an installed (standalone) PWA — scrolls the *document* up to lift a
 * focused input above the on-screen keyboard, even when the focus lives inside a fixed overlay (e.g.
 * the comment composer's bottom sheet). When the keyboard is then dismissed WebKit can leave the
 * layout viewport stuck in that scrolled-up state. Our app shell is `height:100%` + `overflow:hidden`,
 * so the body has no scrollbar to drag back — the page looks shifted up and frozen until the next
 * focus recomputes it.
 *
 * The document scroll is always meant to be at the origin here (every scrollable region is an inner
 * container), so once the keyboard closes we simply snap it back to (0, 0). Call once, app-wide.
 */
export function useKeyboardScrollReset(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const isKeyboardOpen = () => window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX
    let keyboardWasOpen = isKeyboardOpen()

    const reset = () => {
      window.scrollTo(0, 0)
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0
    }

    const onResize = () => {
      const keyboardOpen = isKeyboardOpen()
      // Only act on the open → closed transition. Reset now and again next frame, since WebKit may run
      // its own dismiss scroll around the same tick and we want the last word.
      if (keyboardWasOpen && !keyboardOpen) {
        reset()
        requestAnimationFrame(reset)
      }
      keyboardWasOpen = keyboardOpen
    }

    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])
}
