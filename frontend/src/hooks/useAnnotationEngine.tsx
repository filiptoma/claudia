import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode, RefObject } from 'react'
import { useAuth } from '../context/AuthContext'
import { toast } from '../lib/toast'
import {
  caretAtPoint,
  captureSelection,
  clearHighlights,
  flatOffset,
  paintHighlights,
  resolveAnchor,
} from '../lib/anchor'
import type { Capture, HighlightName } from '../lib/anchor'
import { useAnnotationActions, useDocumentComments, useDocumentSuggestions } from './useAnnotations'
import { DRAFT_KEY } from '../context/AnnotationContext'
import type { AnnotationContextValue, Draft, VirtualAnchor } from '../context/AnnotationContext'
import { useAnnotationRail } from '../context/AnnotationRailContext'
import SelectionToolbar from '../components/annotations/SelectionToolbar'
import AnnotationSidebar from '../components/annotations/AnnotationSidebar'
import AnnotationFloatingPanel from '../components/annotations/AnnotationFloatingPanel'
import AnnotationFocusSheet from '../components/annotations/AnnotationFocusSheet'
import { useAnnotationLayout } from './useAnnotationLayout'
import type { FocusMode, ListMode } from './useAnnotationLayout'

interface SelInfo {
  rect: DOMRect
  capture: Capture
  range: Range
}

interface Bound {
  key: string
  start: number
  end: number
}

export type MarginKind = 'comment' | 'suggestion'

export interface MarginGroup {
  top: number
  items: Array<{ key: string; kind: MarginKind; active: boolean; resolved?: boolean }>
}

function getScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

// Like getScrollParent but matched by overflow STYLE alone (not current overflow), so the popover's
// collision boundary resolves to the scroll container (view area / split preview pane) even before its
// content overflows.
function getClipContainer(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return node
    node = node.parentElement
  }
  return null
}

function groupByY(placements: Record<string, number | null>, tolerance = 18): Array<{ top: number; keys: string[] }> {
  const entries = Object.entries(placements).filter(([, top]) => top !== null) as [string, number][]
  entries.sort(([, a], [, b]) => a - b)
  const groups: Array<{ top: number; keys: string[] }> = []
  for (const [key, top] of entries) {
    const last = groups[groups.length - 1]
    if (last && top - last.top <= tolerance) last.keys.push(key)
    else groups.push({ top, keys: [key] })
  }
  return groups
}

export interface AnnotationEngine {
  ctx: AnnotationContextValue
  onDocClick: (e: MouseEvent<HTMLDivElement>) => void
  /** SelectionToolbar + floating window / focus sheet + sidebar (all fixed-position). */
  overlays: ReactNode
  /** Margin indicator groups (desktop view mode only). */
  marginGroups: MarginGroup[]
  /** Pending suggestions in the shape DocView/Markdown expect for inline diff rendering. */
  suggestionDiffs: { id: string; sourceStart: number; sourceEnd: number; suggested: string }[]
  activate: (key: string) => void
  /** Single active/creating annotation UI: 'popover' (non-touch) or 'sheet' (touch short bottom sheet). */
  focusMode: FocusMode
  /** Comments & suggestions list UI: 'sidebar' (right rail) or 'sheet' (full-height bottom sheet). */
  listMode: ListMode
  /** Measured height of the mobile focus sheet — pad the doc bottom by this so content isn't hidden. */
  focusSheetHeight: number
  activeKey: string | null
  pendingCount: number
  /** Whether the document has ANY comments/suggestions (so viewers can open the list to read them). */
  hasAnnotations: boolean
}

/**
 * The shared annotations engine: highlight painting, selection capture, the active/draft state
 * machine, and the fixed-position overlays (selection toolbar, floating window / focus sheet,
 * sidebar). It is hosted by the read-mode `AnnotationLayer` and by the split editor's preview pane,
 * which each render the document content (with `docRef` + `onDocClick`) and the returned `overlays`.
 *
 * `content` must be the markdown that is currently rendered into `docRef` (saved content in read
 * mode, the live preview in split mode), so rendered selections map back to the right source offsets.
 * The host owns `docRef` (and attaches it to the rendered markdown container) so the engine only ever
 * touches it inside effects and event handlers.
 */
export function useAnnotationEngine({
  docRef,
  docId,
  projectId,
  content,
  canEdit,
  canComment,
  floatingTop,
}: {
  docRef: RefObject<HTMLDivElement | null>
  docId: string
  projectId: string
  content: string
  canEdit: boolean
  canComment: boolean
  floatingTop: number
}): AnnotationEngine {
  const { uid } = useAuth()
  const { focusMode, listMode } = useAnnotationLayout()
  const { setOpen: setRailOpen } = useAnnotationRail()
  const { threads, messagesByThread } = useDocumentComments(docId)
  const { suggestions, messagesBySuggestion } = useDocumentSuggestions(docId)
  const actions = useAnnotationActions(docId)

  const rangesRef = useRef(new Map<string, Range>())
  const boundsRef = useRef<Bound[]>([])

  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState<SelInfo | null>(null)
  const [placements, setPlacements] = useState<Record<string, number | null>>({})
  const [tick, setTick] = useState(0)
  const [focusSheetHeight, setFocusSheetHeight] = useState(0)
  const [boundaryEl, setBoundaryEl] = useState<Element | null>(null)
  const [docEl, setDocEl] = useState<HTMLElement | null>(null)

  // ---- desktop popover anchor ----
  // A Floating-UI virtual element reporting the active annotation's rendered rect. We rebuild it (new
  // identity) only when activeKey changes to a NON-null key — the key is captured in the closure and
  // the rect read live from rangesRef at call time (so it follows scroll). The new identity makes
  // Radix re-anchor to the new range. Keeping the last anchor while activeKey is null means the closing
  // popover animates out in place (no flash to the top-left); lastRect is a fallback if the range is
  // gone. Refs are read here to *construct* that element, not for rendering — a false positive on the
  // rule, whose "access refs in handlers/effects" intent is met by the getter itself.
  /* eslint-disable react-hooks/refs */
  const lastRectRef = useRef<DOMRect>(new DOMRect())
  const anchorRef = useRef<VirtualAnchor>({ getBoundingClientRect: () => lastRectRef.current })
  const anchorKeyRef = useRef<string | null | undefined>(undefined)
  if (activeKey && anchorKeyRef.current !== activeKey) {
    anchorKeyRef.current = activeKey
    const key = activeKey
    anchorRef.current = {
      getBoundingClientRect: () => {
        const range = rangesRef.current.get(key)
        if (range) lastRectRef.current = range.getBoundingClientRect()
        return lastRectRef.current
      },
      contextElement: docRef.current ?? undefined,
    }
  }
  /* eslint-enable react-hooks/refs */

  // The popover stays within the document's scroll container (the view area in read mode, the preview
  // pane in split mode); `docEl` lets the panel tell in-document clicks (handled by onDocClick) from
  // truly-outside clicks (which dismiss it). Resolved once the doc is mounted.
  useEffect(() => {
    setDocEl(docRef.current)
    setBoundaryEl(docRef.current ? getClipContainer(docRef.current) : null)
  }, [docRef])

  // Reserve layout room for the docked rail (only in 'sidebar' mode — the bottom sheet overlays). The
  // layout shifts the document content aside; reset on close / unmount so other pages aren't padded.
  const reserveRail = listMode === 'sidebar' && sidebarOpen
  useEffect(() => {
    setRailOpen(reserveRail)
    return () => setRailOpen(false)
  }, [setRailOpen, reserveRail])

  // Only unresolved comments and pending suggestions are shown inline (highlights, margin dots, the
  // inline diff). Resolved comments and accepted/rejected suggestions live only in the sidebar.
  const unresolvedThreads = useMemo(() => threads.filter((t) => !t.resolved), [threads])
  const pendingSuggestions = useMemo(() => suggestions.filter((s) => s.status === 'pending'), [suggestions])

  useEffect(() => {
    const el = docRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setTick((t) => t + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [docRef])

  // ---- resolve anchors → paint highlights + compute margin indicator positions ----
  useLayoutEffect(() => {
    const root = docRef.current
    if (!root) return
    const rootTop = root.getBoundingClientRect().top
    const place: Record<string, number | null> = {}
    const bounds: Bound[] = []
    const ranges = new Map<string, Range>()
    const groups: Record<HighlightName, Range[]> = {
      comment: [],
      'comment-active': [],
      suggestion: [],
      'suggestion-active': [],
    }

    // Comments paint via the CSS Custom Highlight API; saved suggestions are rendered inline as a diff
    // by rehypeSuggestionDiff (so `paint` is false — we still resolve their range for the margin dot,
    // click hit-testing and scroll-to).
    const handle = (key: string, kind: 'comment' | 'suggestion', anchor: Capture['anchor'], paint: boolean) => {
      const range = resolveAnchor(root, anchor)
      if (!range) {
        place[key] = null
        return
      }
      ranges.set(key, range)
      place[key] = range.getBoundingClientRect().top - rootTop
      bounds.push({
        key,
        start: flatOffset(root, range.startContainer, range.startOffset),
        end: flatOffset(root, range.endContainer, range.endOffset),
      })
      if (paint) {
        const active = key === activeKey
        groups[kind === 'comment' ? (active ? 'comment-active' : 'comment') : 'suggestion'].push(range)
      }
    }

    for (const t of unresolvedThreads) handle(t.id, 'comment', t.anchor, true)
    for (const s of pendingSuggestions) handle(s.id, 'suggestion', s.anchor, false)
    if (draft) {
      groups[draft.kind === 'comment' ? 'comment-active' : 'suggestion-active'].push(draft.range)
      place[DRAFT_KEY] = draft.top
      ranges.set(DRAFT_KEY, draft.range)
    }

    paintHighlights(groups)

    // Emphasize the active inline suggestion (rendered by rehypeSuggestionDiff) via a data attribute —
    // a className/attribute toggle is React-safe (it survives no-op re-renders and self-heals on real
    // ones), unlike injecting nodes into the React-owned DOM.
    root.querySelectorAll('[data-sug-id][data-active]').forEach((el) => el.removeAttribute('data-active'))
    if (activeKey && activeKey !== DRAFT_KEY) {
      root
        .querySelectorAll(`[data-sug-id="${CSS.escape(activeKey)}"]`)
        .forEach((el) => el.setAttribute('data-active', ''))
    }

    rangesRef.current = ranges
    boundsRef.current = bounds
    setPlacements((prev) => {
      const k = Object.keys(place)
      if (k.length === Object.keys(prev).length && k.every((key) => prev[key] === place[key])) return prev
      return place
    })
  }, [docRef, unresolvedThreads, pendingSuggestions, activeKey, draft, content, tick])

  useEffect(() => () => clearHighlights(), [])

  // ---- selection listener → toolbar ----
  useEffect(() => {
    if (!uid || !canComment) return
    let raf = 0
    const sync = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const root = docRef.current
        if (!root || draft) {
          setSelection(null)
          return
        }
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setSelection(null)
          return
        }
        const range = sel.getRangeAt(0)
        if (!root.contains(range.commonAncestorContainer)) {
          setSelection(null)
          return
        }
        const capture = captureSelection(root, range, content)
        if (!capture) {
          setSelection(null)
          return
        }
        setSelection({ rect: range.getBoundingClientRect(), capture, range: range.cloneRange() })
      })
    }
    document.addEventListener('selectionchange', sync)
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('selectionchange', sync)
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
    }
  }, [docRef, uid, canComment, draft, content])

  // `bottomInset` reserves space at the bottom of the scroller (the mobile focus sheet covers it), so
  // an item hidden behind the sheet counts as out-of-view and gets scrolled up clear of it.
  const scrollToKey = useCallback((key: string, bottomInset = 0) => {
    const range = rangesRef.current.get(key)
    const root = docRef.current
    if (!range || !root) return
    const scroller = getScrollParent(root)
    if (!scroller) return
    const r = range.getBoundingClientRect()
    const sr = scroller.getBoundingClientRect()
    if (r.top < sr.top + 64 || r.bottom > sr.bottom - bottomInset - 64) {
      scroller.scrollTo({ top: scroller.scrollTop + (r.top - sr.top) - 140, behavior: 'smooth' })
    }
  }, [docRef])

  // Activating selects an annotation (highlight emphasis + sidebar selection / floating window) and
  // scrolls its anchor into view. It does NOT touch the sidebar: when the sidebar is open the
  // selection is shown there; when closed, the floating window appears.
  const activate = useCallback(
    (key: string) => {
      setActiveKey(key)
      // When the short bottom sheet will cover the bottom of the screen (touch + sidebar closed) we
      // scroll once its height is known (the effect below) so the anchor lands clear of it. Otherwise
      // (desktop popover, or the sidebar/rail is open) scroll immediately.
      if (!(focusMode === 'sheet' && !sidebarOpen)) scrollToKey(key)
    },
    [scrollToKey, focusMode, sidebarOpen],
  )

  // Touch (short bottom sheet): once the focus sheet is open and measured, scroll the active
  // annotation's anchor into the region above it. Drafts grow while the user types, so key those by id
  // alone (scroll once); real annotations are stable, so key them by height too — re-checking
  // visibility after the sheet settles and when cycling (◂ ▸) to a taller neighbour that the
  // just-measured height reveals as hidden.
  const lastScrollRef = useRef<string | null>(null)
  useEffect(() => {
    if (focusMode !== 'sheet' || sidebarOpen || !activeKey || focusSheetHeight <= 0) {
      if (!activeKey) lastScrollRef.current = null
      return
    }
    const sig = activeKey === DRAFT_KEY ? DRAFT_KEY : `${activeKey}:${focusSheetHeight}`
    if (lastScrollRef.current === sig) return
    lastScrollRef.current = sig
    scrollToKey(activeKey, focusSheetHeight + 24)
  }, [focusMode, sidebarOpen, activeKey, focusSheetHeight, scrollToKey])

  const deactivate = useCallback(() => setActiveKey(null), [])

  // Closing the sidebar also drops the selection — otherwise the previously-selected item would stay
  // highlighted and its floating window would pop open (it shows whenever activeKey && !sidebarOpen).
  const closeSidebar = useCallback(() => {
    setSidebarOpen(false)
    setActiveKey(null)
  }, [])

  const startDraft = useCallback(
    (kind: 'comment' | 'suggestion', capture: Capture, range: Range, top: number) => {
      setDraft({ kind, capture, range, top })
      setActiveKey(DRAFT_KEY)
      setSidebarOpen(false)
      setSelection(null)
      window.getSelection()?.removeAllRanges()
    },
    [],
  )

  const cancelDraft = useCallback(() => {
    setDraft(null)
    setActiveKey(null)
  }, [])

  const submitComment = useCallback(
    async (body: string, mentions: string[]) => {
      if (!draft || busy) return
      setBusy(true)
      try {
        await actions.createThread({
          anchor: draft.capture.anchor,
          sourceStart: draft.capture.sourceStart,
          sourceEnd: draft.capture.sourceEnd,
          body,
          mentions,
        })
        cancelDraft()
      } catch (e) {
        toast('error', e instanceof Error ? e.message : 'Failed to add comment')
      } finally {
        setBusy(false)
      }
    },
    [draft, busy, actions, cancelDraft],
  )

  const submitSuggestion = useCallback(
    async (suggestedMd: string, note: string, mentions: string[]) => {
      if (!draft || busy) return
      setBusy(true)
      try {
        await actions.createSuggestion({
          anchor: draft.capture.anchor,
          sourceStart: draft.capture.sourceStart,
          sourceEnd: draft.capture.sourceEnd,
          originalMd: content.slice(draft.capture.sourceStart, draft.capture.sourceEnd),
          suggestedMd,
          note,
          mentions,
        })
        cancelDraft()
      } catch (e) {
        toast('error', e instanceof Error ? e.message : 'Failed to add suggestion')
      } finally {
        setBusy(false)
      }
    },
    [draft, busy, actions, content, cancelDraft],
  )

  // Click within the document: hit-test to select an annotation. A plain click that lands on no
  // annotation dismisses the active popover / focus sheet (cancelling an in-progress draft, or
  // deselecting). Clicks on links or with an active text selection are left alone.
  const onDocClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('a')) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    // Inline suggestion diff: clicking anywhere within it (struck original or green insertion) selects it.
    const sugId = target.closest('[data-sug-id]')?.getAttribute('data-sug-id')
    if (sugId) {
      activate(sugId)
      return
    }
    const root = docRef.current
    const caret = root ? caretAtPoint(e.clientX, e.clientY) : null
    if (root && caret && root.contains(caret.node)) {
      const pos = flatOffset(root, caret.node, caret.offset)
      const hit = boundsRef.current.find((b) => pos >= b.start && pos < b.end)
      if (hit) {
        activate(hit.key)
        return
      }
    }
    // Empty space → dismiss the popover (cancelling a draft, or deselecting). The touch short bottom
    // sheet keeps its explicit close button, so tapping the doc there doesn't close it.
    if (focusMode === 'popover') {
      if (draft) cancelDraft()
      else deactivate()
    }
  }, [docRef, activate, deactivate, draft, cancelDraft, focusMode])

  const onSelectionComment = useCallback(() => {
    if (!selection || !docRef.current) return
    const top = selection.range.getBoundingClientRect().top - docRef.current.getBoundingClientRect().top
    startDraft('comment', selection.capture, selection.range, top)
  }, [docRef, selection, startDraft])

  const onSelectionSuggest = useCallback(() => {
    if (!selection || !docRef.current) return
    const top = selection.range.getBoundingClientRect().top - docRef.current.getBoundingClientRect().top
    startDraft('suggestion', selection.capture, selection.range, top)
  }, [docRef, selection, startDraft])

  const threadIds = useMemo(() => new Set(unresolvedThreads.map((t) => t.id)), [unresolvedThreads])
  const suggestionIds = useMemo(() => new Set(pendingSuggestions.map((s) => s.id)), [pendingSuggestions])
  const pendingCount = unresolvedThreads.length + pendingSuggestions.length

  const suggestionDiffs = useMemo(
    () =>
      pendingSuggestions.map((s) => ({
        id: s.id,
        sourceStart: s.source_start,
        sourceEnd: s.source_end,
        suggested: s.suggested_md,
      })),
    [pendingSuggestions],
  )

  const marginGroups = useMemo<MarginGroup[]>(() => {
    return groupByY(placements).map((group) => ({
      top: group.top,
      items: group.keys.map((k) => ({
        key: k,
        kind: threadIds.has(k) ? 'comment' : suggestionIds.has(k) ? 'suggestion' : draft?.kind ?? 'comment',
        active: activeKey === k,
        resolved: threads.find((t) => t.id === k)?.resolved,
      })),
    }))
  }, [placements, threadIds, suggestionIds, draft, activeKey, threads])

  const ctx = useMemo<AnnotationContextValue>(
    () => ({
      docId,
      projectId,
      content,
      threads,
      messagesByThread,
      suggestions,
      messagesBySuggestion,
      actions,
      uid,
      canEdit,
      canComment,
      activeKey,
      activate,
      deactivate,
      sidebarOpen,
      setSidebarOpen,
      closeSidebar,
      floatingTop,
      anchorRef,
      boundaryEl,
      docEl,
      pendingCount,
      draft,
      startDraft,
      cancelDraft,
      submitComment,
      submitSuggestion,
      placements,
      busy,
      listMode,
    }),
    [
      docId, projectId, content, threads, messagesByThread, suggestions, messagesBySuggestion,
      actions, uid, canEdit, canComment, activeKey, activate, deactivate, sidebarOpen,
      closeSidebar, floatingTop, anchorRef, boundaryEl, docEl, pendingCount, draft, startDraft, cancelDraft,
      submitComment, submitSuggestion, placements, busy, listMode,
    ],
  )

  const overlays = (
    <>
      {selection && uid && canComment && !draft && (
        <SelectionToolbar
          rect={selection.rect}
          canEdit={canEdit}
          onComment={onSelectionComment}
          onSuggest={onSelectionSuggest}
        />
      )}
      {focusMode === 'popover' && !sidebarOpen && <AnnotationFloatingPanel />}
      {focusMode === 'sheet' && activeKey && !sidebarOpen && (
        <AnnotationFocusSheet onHeightChange={setFocusSheetHeight} />
      )}
      <AnnotationSidebar />
    </>
  )

  return {
    ctx,
    onDocClick,
    overlays,
    marginGroups,
    suggestionDiffs,
    activate,
    focusMode,
    listMode,
    focusSheetHeight,
    activeKey,
    pendingCount,
    hasAnnotations: threads.length > 0 || suggestions.length > 0,
  }
}
