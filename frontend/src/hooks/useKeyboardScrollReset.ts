import { useEffect } from 'react'

// A shrink smaller than this (relative to the keyboard-free baseline) is almost certainly browser
// chrome rather than the on-screen keyboard.
const KEYBOARD_THRESHOLD_PX = 150
// Reassert the scroll origin across roughly this many frames (~330ms) after the keyboard closes.
const SETTLE_FRAMES = 20

/**
 * iOS/iPadOS — most visibly in an installed (standalone) PWA — scrolls the *page* up to lift a focused
 * input above the on-screen keyboard, even when the field lives in a fixed/absolute overlay (a modal,
 * the comment composer's bottom sheet, the docked comments rail). When the keyboard is dismissed WebKit
 * does not reliably undo that, so the whole document (and the fixed elements anchored to it) stays
 * shifted up — the app shell is `height:100%` + `overflow:hidden`, so there is no scrollbar to recover.
 *
 * The page scroll is always meant to be at the origin here (every scrollable region is an inner
 * container), so whenever the keyboard is NOT up we keep it pinned to (0, 0). Call once, app-wide.
 *
 * Subtleties this guards against:
 *  - Detection: in a standalone PWA `window.innerHeight` can track the visual viewport and shrink with
 *    the keyboard too, so `innerHeight - visualViewport.height` never crosses the threshold. We instead
 *    compare the live height against the tallest height seen (the keyboard-free baseline), re-baselining
 *    on width changes (rotation / Stage Manager) so a shorter orientation isn't mistaken for a keyboard.
 *  - Silent offset: WebKit can leave the page scrolled without a fresh scroll event, and can re-apply
 *    the offset a frame or two after the dismiss. After a close we reassert the origin across a short
 *    window, bailing if the keyboard reopens (the user moved straight to another field).
 *  - Late offset via a scroll event: a `scroll` listener pins the page back whenever the keyboard is
 *    down. While it IS up we leave the scroll alone, so WebKit's reveal of the focused field still works.
 */
export function useKeyboardScrollReset(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    let baseline = vv.height
    let lastWidth = vv.width
    let keyboardOpen = false
    let raf = 0

    const resetScroll = () => {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
      const se = document.scrollingElement
      if (se && se.scrollTop) se.scrollTop = 0
      if (document.body.scrollTop) document.body.scrollTop = 0
    }

    const onResize = () => {
      // A width change is an orientation / window resize, never the keyboard — re-baseline and bail.
      if (vv.width !== lastWidth) {
        lastWidth = vv.width
        baseline = vv.height
        keyboardOpen = false
        cancelAnimationFrame(raf)
        return
      }

      if (vv.height > baseline) baseline = vv.height
      const open = vv.height < baseline - KEYBOARD_THRESHOLD_PX

      if (keyboardOpen && !open) {
        // Keyboard just closed — reassert the origin across a short window to beat any late re-offset.
        cancelAnimationFrame(raf)
        let n = 0
        const tick = () => {
          if (vv.height < baseline - KEYBOARD_THRESHOLD_PX) return // reopened — stop fighting it
          resetScroll()
          if (++n < SETTLE_FRAMES) raf = requestAnimationFrame(tick)
        }
        tick()
      }
      keyboardOpen = open
    }

    // Pin the page back on any stray scroll while the keyboard is down (guarded so we never fight the
    // reveal while it's up). The reset is a no-op when already at the origin, so this can't loop.
    const onScroll = () => {
      if (!keyboardOpen) resetScroll()
    }

    vv.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])
}
