import { useEffect, useState } from 'react'

// "Touch" = the device's PRIMARY pointer is coarse (it's actually being driven by touch right now), the
// same definition useAnnotationLayout uses. A touch laptop or a tablet with a trackpad reports a fine
// primary pointer and is treated as non-touch. Updates live when a mouse is docked/undocked.
const TOUCH_MQ = '(pointer: coarse)'

export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(() => window.matchMedia(TOUCH_MQ).matches)
  useEffect(() => {
    const mq = window.matchMedia(TOUCH_MQ)
    const handler = (e: MediaQueryListEvent) => setTouch(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return touch
}
