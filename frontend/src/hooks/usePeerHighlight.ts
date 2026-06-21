import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Decoration, EditorView } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Extension } from '@codemirror/state'
import { captureSelection, rangeForSourceSpan, supportsHighlights } from '../lib/anchor'
import { preprocessImageSizesMapped, rawToPreprocessed } from '../lib/mdImage'

// Two-way "where am I" highlight between the source editor and the rendered preview (split mode,
// markdown only). Select text in either pane → the matching text lights up in the other; with only a
// caret/click → the enclosing block lights up. It reuses the same source↔rendered mapping the
// annotation engine relies on: the preview's `.sp` spans (char offsets) and `data-startline`
// (block line stamps), both already emitted in split mode (Markdown is rendered with `annotate` +
// `sourceLines`). The two directions never feed back into each other: editor→preview only paints
// (CSS Custom Highlight + a data attribute, no DOM-selection or doc change) and only while the editor
// is focused; preview→editor only sets editor decorations (no doc/selection change) and only while
// the live selection sits inside the preview.

// CSS Custom Highlight registry key for the preview-side mirror (separate from the annotation
// engine's `an-*` keys, so the two never clobber each other).
const PEER_KEY = 'peer'

type PeerTarget =
  | { kind: 'mark'; from: number; to: number }
  | { kind: 'block'; fromLine: number; toLine: number }
  | null

// ---- editor side: a decoration field driven by an effect (preview → editor) ----

const setPeer = StateEffect.define<PeerTarget>()
const peerMark = Decoration.mark({ class: 'cm-peer' })
const peerLine = Decoration.line({ class: 'cm-peer-line' })

function decoForTarget(state: EditorState, t: PeerTarget): DecorationSet {
  if (!t) return Decoration.none
  if (t.kind === 'mark') {
    const from = Math.max(0, Math.min(t.from, state.doc.length))
    const to = Math.max(from, Math.min(t.to, state.doc.length))
    return from < to ? Decoration.set([peerMark.range(from, to)]) : Decoration.none
  }
  const ranges = []
  const last = state.doc.lines
  for (let ln = Math.max(1, t.fromLine); ln <= Math.min(last, t.toLine); ln++) {
    ranges.push(peerLine.range(state.doc.line(ln).from))
  }
  return ranges.length ? Decoration.set(ranges, true) : Decoration.none
}

const peerField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes)
    let setExplicitly = false
    for (const e of tr.effects) {
      if (e.is(setPeer)) {
        next = decoForTarget(tr.state, e.value)
        setExplicitly = true
      }
    }
    // A preview-sourced highlight goes stale the moment the user edits; drop it unless this very
    // transaction re-set it. Pure selection/scroll transactions keep the mapped decoration.
    if (!setExplicitly && tr.docChanged) return Decoration.none
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

function dispatchPeer(view: EditorView, target: PeerTarget): void {
  if (view.state.field(peerField, false) === undefined) return
  view.dispatch({ effects: setPeer.of(target) })
}

function targetKey(t: PeerTarget): string {
  if (!t) return ''
  return t.kind === 'mark' ? `m:${t.from}:${t.to}` : `b:${t.fromLine}:${t.toLine}`
}

// ---- preview side helpers ----

function clearPreviewPeer(root: HTMLElement | null): void {
  if (supportsHighlights()) CSS.highlights.delete(PEER_KEY)
  root?.querySelectorAll('[data-peer-active]').forEach((el) => el.removeAttribute('data-peer-active'))
}

// Smallest block whose [startline, endline] contains `line` (innermost; deeper DOM wins ties).
function innermostBlockForLine(root: HTMLElement, line: number): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestSpan = Infinity
  root.querySelectorAll<HTMLElement>('[data-startline]').forEach((el) => {
    const s = Number(el.dataset.startline)
    if (!Number.isFinite(s)) return
    const e = Number(el.dataset.endline)
    const end = Number.isFinite(e) ? e : s
    if (line >= s && line <= end && end - s <= bestSpan) {
      bestSpan = end - s
      best = el
    }
  })
  return best
}

/**
 * Wire up the two-way peer highlight. Returns a CodeMirror extension the editor must install (the
 * decoration field + the selection listener that paints the preview). `enabled` should be true only
 * in split mode; `content` must be the markdown currently rendered into `previewEl`.
 */
export function usePeerHighlight({
  enabled,
  cmView,
  previewEl,
  content,
}: {
  enabled: boolean
  cmView: EditorView | null
  previewEl: HTMLElement | null
  content: string
}): { extension: Extension } {
  const enabledRef = useRef(enabled)
  const previewRef = useRef(previewEl)
  const contentRef = useRef(content)
  const viewRef = useRef(cmView)
  // Keep refs current for the stable extension/effect callbacks (synced before the layout effects
  // below run, so a repaint always sees the latest values). Updating refs in an effect — not during
  // render — matches the rest of the codebase and the react-hooks/refs rule.
  useLayoutEffect(() => {
    enabledRef.current = enabled
    previewRef.current = previewEl
    contentRef.current = content
    viewRef.current = cmView
  })

  // ---- editor → preview: paint the editor's selection (or active block) into the preview ----
  const paintToPreview = useCallback(() => {
    const root = previewRef.current
    clearPreviewPeer(root)
    const view = viewRef.current
    // Only the focused pane drives; when the editor blurs, the preview takes over (and this clears).
    if (!enabledRef.current || !view || !root || !view.hasFocus) return
    const sel = view.state.selection.main
    if (sel.empty) {
      const block = innermostBlockForLine(root, view.state.doc.lineAt(sel.head).number)
      block?.setAttribute('data-peer-active', '')
      return
    }
    const { map } = preprocessImageSizesMapped(contentRef.current)
    const range = rangeForSourceSpan(
      root,
      rawToPreprocessed(sel.from, map),
      rawToPreprocessed(sel.to, map),
    )
    if (range && supportsHighlights()) CSS.highlights.set(PEER_KEY, new Highlight(range))
  }, [])

  // Stable extension: `paintToPreview` has a stable identity (it reads live state through refs), so
  // this useMemo never recomputes and the editor is never rebuilt.
  const extension = useMemo<Extension>(
    () =>
      [
        peerField,
        // paintToPreview reads refs at event time (on a CM update), not during render — false positive.
        // eslint-disable-next-line react-hooks/refs
        EditorView.updateListener.of((u: ViewUpdate) => {
          if (u.selectionSet || u.docChanged || u.focusChanged) paintToPreview()
        }),
      ] as Extension,
    [paintToPreview],
  )

  // Repaint after the preview re-renders (its DOM nodes — and our stale range/attribute — were
  // replaced). Layout effect so it lands before the browser paints (no flicker).
  useLayoutEffect(() => {
    paintToPreview()
  }, [content, previewEl, enabled, paintToPreview])

  // ---- preview → editor: mirror a rendered selection (or clicked block) back into the editor ----
  useEffect(() => {
    if (!enabled || !previewEl || !cmView) return
    const root = previewEl
    const view = cmView
    let raf = 0
    let lastKey = ''
    const apply = (target: PeerTarget) => {
      const key = targetKey(target)
      if (key === lastKey) return // avoid a transaction per keystroke/caret move
      lastKey = key
      dispatchPeer(view, target)
    }
    const sync = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const sel = window.getSelection()
        const node = sel?.anchorNode ?? null
        if (!sel || sel.rangeCount === 0 || !node || !root.contains(node)) {
          apply(null) // selection left the preview (e.g. moved into the editor) → clear
          return
        }
        if (sel.isCollapsed) {
          const host = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
          const block = host?.closest<HTMLElement>('[data-startline]')
          const from = block ? Number(block.dataset.startline) : NaN
          if (!block || !Number.isFinite(from)) {
            apply(null)
            return
          }
          const to = Number(block.dataset.endline)
          apply({ kind: 'block', fromLine: from, toLine: Number.isFinite(to) ? to : from })
          return
        }
        const cap = captureSelection(root, sel.getRangeAt(0), contentRef.current)
        apply(cap ? { kind: 'mark', from: cap.sourceStart, to: cap.sourceEnd } : null)
      })
    }
    document.addEventListener('selectionchange', sync)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('selectionchange', sync)
      dispatchPeer(view, null)
    }
  }, [enabled, previewEl, cmView])

  // Clear both sides when split mode turns off.
  useEffect(() => {
    if (enabled) return
    clearPreviewPeer(previewRef.current)
    if (viewRef.current) dispatchPeer(viewRef.current, null)
  }, [enabled])

  return { extension }
}
