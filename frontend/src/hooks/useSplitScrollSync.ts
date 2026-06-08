import { useEffect } from 'react'

// Anchor two scrollable panes so they scroll together (proportional mapping) in split mode. Shared by
// the markdown and LaTeX editors — it operates on any two scrollable elements.
//
// The hard part is touch: writing `dst.scrollTop` fires a `scroll` event on the destination, and on
// iOS/iPadOS momentum keeps firing scroll events for ~1 s after the finger lifts. If those echoes are
// allowed to drive back, the two panes fight and rounding error walks the position to the top,
// unstoppably. Fix: a per-pane suppression window. Whenever we programmatically write a pane we mute
// its scroll handler briefly; the driving pane keeps refreshing that window, so every echo (and the
// follower's own momentum) is ignored until the gesture goes quiet. A finger landing on a pane makes
// it the driver at once and mutes the other so leftover momentum can't hijack the sync. Unlike a
// lock cleared on rAF, this is timing-independent — it never relies on the echo beating a frame.
export function useSplitScrollSync(
  enabled: boolean,
  left: HTMLElement | null,
  right: HTMLElement | null,
) {
  useEffect(() => {
    if (!enabled || !left || !right) return
    // performance.now() timestamps up to which each pane's scroll events are treated as echoes to ignore.
    const muteUntil = { left: 0, right: 0 }
    const SUPPRESS_MS = 150
    const sync = (src: HTMLElement, dst: HTMLElement, dstKey: 'left' | 'right') => {
      const sMax = src.scrollHeight - src.clientHeight
      const dMax = dst.scrollHeight - dst.clientHeight
      if (sMax <= 0 || dMax <= 0) return
      const target = (src.scrollTop / sMax) * dMax
      // Skip no-op writes: writing fires no scroll event, so arming a mute window here would only swallow
      // the follower's next genuine user scroll.
      if (Math.abs(dst.scrollTop - target) <= 0.5) return
      muteUntil[dstKey] = performance.now() + SUPPRESS_MS
      dst.scrollTop = target
    }
    const onLeft = () => {
      if (performance.now() < muteUntil.left) return
      sync(left, right, 'right')
    }
    const onRight = () => {
      if (performance.now() < muteUntil.right) return
      sync(right, left, 'left')
    }
    // A finger on a pane is the user's intent to drive it: clear its own mute and mute the other so the
    // other's lingering momentum can't fight the new gesture.
    const onLeftTouch = () => { muteUntil.left = 0; muteUntil.right = performance.now() + SUPPRESS_MS }
    const onRightTouch = () => { muteUntil.right = 0; muteUntil.left = performance.now() + SUPPRESS_MS }
    left.addEventListener('scroll', onLeft, { passive: true })
    right.addEventListener('scroll', onRight, { passive: true })
    left.addEventListener('touchstart', onLeftTouch, { passive: true })
    right.addEventListener('touchstart', onRightTouch, { passive: true })
    return () => {
      left.removeEventListener('scroll', onLeft)
      right.removeEventListener('scroll', onRight)
      left.removeEventListener('touchstart', onLeftTouch)
      right.removeEventListener('touchstart', onRightTouch)
    }
  }, [enabled, left, right])
}
