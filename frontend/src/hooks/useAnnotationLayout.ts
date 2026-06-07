import { useEffect, useState } from 'react'

/** Single active/creating annotation: the desktop popover, or the touch short bottom sheet. */
export type FocusMode = 'popover' | 'sheet'
/** Comments & suggestions list: the right-rail sidebar, or a full-height bottom sheet. */
export type ListMode = 'sidebar' | 'sheet'

export interface AnnotationLayout {
  focusMode: FocusMode
  listMode: ListMode
  isTouch: boolean
}

// Width thresholds, from the project's breakpoint → device map:
//   < sm                       mobile (phone)
//   sm–lg, touch               tablet, portrait
//   lg–xl / xl+, touch         tablet, landscape  (a large landscape tablet can exceed xl)
//   ≥ sm, non-touch            desktop / laptop
const SM_MQ = '(min-width: 640px)'
const LG_MQ = '(min-width: 1024px)'
// "Touch" means the device's PRIMARY pointer is coarse — i.e. it's actually being driven by touch
// right now. A touch laptop (or a tablet with a trackpad/mouse attached) reports a fine primary
// pointer, so it gets the desktop popover, not the short bottom sheet. We deliberately use
// `pointer: coarse` rather than `any-pointer: coarse` / maxTouchPoints (which only tell us a
// touchscreen EXISTS): `pointer: coarse` tracks the active pointer and updates live when a mouse is
// docked/undocked.
const TOUCH_MQ = '(pointer: coarse)'

function detectTouch(): boolean {
  return window.matchMedia(TOUCH_MQ).matches
}

/**
 * Pure decision core (split out from DOM reads so it can be reasoned about / tested directly):
 *  - `geSm` = viewport ≥ sm (640px), `geLg` = viewport ≥ lg (1024px).
 *  - Popover only on non-touch; short bottom sheet only on touch.
 *  - Full-height bottom sheet for the list on true-mobile widths (< sm) and on portrait tablets (touch
 *    below lg). Everywhere else — landscape tablets, laptops, desktops, AND non-touch screens that
 *    happen to fall in tablet width ranges — the right-rail sidebar.
 */
export function resolveLayout(isTouch: boolean, geSm: boolean, geLg: boolean): AnnotationLayout {
  const focusMode: FocusMode = isTouch ? 'sheet' : 'popover'
  const listMode: ListMode = !geSm || (isTouch && !geLg) ? 'sheet' : 'sidebar'
  return { focusMode, listMode, isTouch }
}

function compute(): AnnotationLayout {
  return resolveLayout(
    detectTouch(),
    window.matchMedia(SM_MQ).matches,
    window.matchMedia(LG_MQ).matches,
  )
}

/**
 * Resolves which annotation UI to render from BOTH the viewport width and whether the primary pointer
 * is touch (coarse) — width alone is not enough:
 *  - a large landscape tablet (e.g. Galaxy Tab S9+) can exceed the xl breakpoint yet must still use the
 *    touch combination (short bottom sheet + sidebar), and
 *  - a small non-touch laptop can fall inside the tablet width ranges yet must use popover + sidebar.
 *
 * Returns:
 *  - focusMode: 'popover' (non-touch) vs 'sheet' (touch short bottom sheet) — the single active item
 *  - listMode:  'sidebar' (right rail) vs 'sheet' (full-height bottom sheet) — the comments/suggestions list
 */
export function useAnnotationLayout(): AnnotationLayout {
  const [layout, setLayout] = useState(compute)
  useEffect(() => {
    // Width changes (resize / rotation) flip listMode; the primary pointer can change too (e.g. docking
    // a mouse), so listen to all three. Some crossings don't change the outcome (e.g. crossing lg on a
    // non-touch screen), so keep the previous object identity when nothing resolved differs.
    const mqs = [SM_MQ, LG_MQ, TOUCH_MQ].map((q) => window.matchMedia(q))
    const update = () =>
      setLayout((prev) => {
        const next = compute()
        return prev.focusMode === next.focusMode &&
          prev.listMode === next.listMode &&
          prev.isTouch === next.isTouch
          ? prev
          : next
      })
    mqs.forEach((mq) => mq.addEventListener('change', update))
    return () => mqs.forEach((mq) => mq.removeEventListener('change', update))
  }, [])
  return layout
}
