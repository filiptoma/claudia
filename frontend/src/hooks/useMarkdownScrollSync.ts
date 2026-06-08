import { useEffect } from 'react'
import type { EditorView } from '@codemirror/view'

// Line-anchored scroll sync for the markdown split editor — the approach HackMD uses, adapted to
// CodeMirror 6 + react-markdown.
//
// A naive `scrollTop/scrollHeight` ratio drifts badly: a 10-line code fence, a one-line image, or a
// long table render to heights that bear no relation to their source length, so the panes slide out of
// alignment. Instead we keep the SAME content at the top of both panes, addressed by source line:
//
//  • The rendered preview blocks carry `data-startline` (see lib/sourceLines). From them we build a
//    "scroll map": a sorted list of {sourceLine → preview pixel offset} anchors. Interpolating between
//    anchors gives a pixel for any (fractional) source line, and inverting it gives the line at any
//    pixel.
//  • CodeMirror 6's height geometry gives the exact pixel ↔ source-line mapping for the editor.
//
// Editor→preview: read the editor's top source line, map it through the scroll map, scroll the preview.
// Preview→editor: read the preview's top source line from the map, map it to an editor pixel, scroll.
//
// Touch is the hard part (same as useSplitScrollSync): writing `dst.scrollTop` fires a scroll event,
// and iOS momentum keeps firing for ~1s after the finger lifts; left unchecked the panes fight and walk
// to the top. Fix: a per-pane suppression window — whenever we write a pane we mute its scroll handler
// briefly, and the driving pane keeps refreshing that window so every echo (and the follower's own
// momentum) is ignored until the gesture goes quiet. A finger landing on a pane makes it the driver and
// mutes the other so leftover momentum can't hijack the sync.
export function useMarkdownScrollSync(
  enabled: boolean,
  view: EditorView | null,
  preview: HTMLElement | null,
) {
  useEffect(() => {
    if (!enabled || !view || !preview) return
    const editor = view.scrollDOM

    // Scroll map: anchors sorted by source line, each carrying its top offset in the preview's scroll
    // coordinate space. Rebuilt lazily (it's dirtied by re-renders / image loads / reflow).
    type Anchor = { line: number; y: number }
    let anchors: Anchor[] = []
    let dirty = true

    const buildMap = () => {
      const blocks = preview.querySelectorAll<HTMLElement>('[data-startline]')
      const pTop = preview.getBoundingClientRect().top - preview.scrollTop
      const list: Anchor[] = []
      let lastLine = -1
      blocks.forEach((el) => {
        const line = parseInt(el.getAttribute('data-startline') || '', 10)
        if (!Number.isFinite(line) || line === lastLine) return // dedupe same-line (parent wins)
        list.push({ line, y: el.getBoundingClientRect().top - pTop })
        lastLine = line
      })
      list.sort((a, b) => a.line - b.line || a.y - b.y)
      // Terminal anchor so lines past the last block extrapolate toward the document's full height
      // (lets the tail of the doc scroll into view in step with the editor's scrollPastEnd slack).
      list.push({ line: view.state.doc.lines + 1, y: preview.scrollHeight })
      // Enforce monotonic offsets — guards against sub-pixel/layout oddities breaking the inversion.
      for (let i = 1; i < list.length; i++) if (list[i].y < list[i - 1].y) list[i].y = list[i - 1].y
      anchors = list
      dirty = false
    }

    // Largest index whose anchor line/offset is <= the probe (binary search; anchors are sorted).
    const floorIndex = (key: 'line' | 'y', value: number) => {
      let lo = 0
      let hi = anchors.length - 1
      let ans = 0
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (anchors[mid][key] <= value) {
          ans = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return ans
    }

    // Preview pixel offset for a (fractional) source line.
    const previewYForLine = (line: number): number => {
      if (anchors.length === 0) return 0
      if (line <= anchors[0].line) return anchors[0].y
      const i = floorIndex('line', line)
      const a = anchors[i]
      const b = anchors[i + 1]
      if (!b) return a.y
      return a.y + ((line - a.line) / (b.line - a.line)) * (b.y - a.y)
    }

    // (Fractional) source line at a given preview pixel offset — the inverse of previewYForLine.
    const lineForPreviewY = (y: number): number => {
      if (anchors.length === 0) return 1
      if (y <= anchors[0].y) return anchors[0].line
      const i = floorIndex('y', y)
      const a = anchors[i]
      const b = anchors[i + 1]
      if (!b || b.y === a.y) return a.line
      return a.line + ((y - a.y) / (b.y - a.y)) * (b.line - a.line)
    }

    const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

    // Source line (+ fraction through it) sitting at the top of the editor viewport. CM6 block heights
    // are measured from the document content top; scrollTop includes the content's top padding.
    const editorTopLine = (): number => {
      const h = Math.max(0, editor.scrollTop - view.documentPadding.top)
      const block = view.lineBlockAtHeight(h)
      const line = view.state.doc.lineAt(block.from).number
      const frac = block.height > 0 ? (h - block.top) / block.height : 0
      return line + clamp01(frac)
    }

    // Editor scrollTop that puts a (fractional) source line at the top of the editor viewport — the
    // inverse of editorTopLine.
    const editorScrollTopForLine = (line: number): number => {
      const doc = view.state.doc
      const ln = Math.max(1, Math.min(doc.lines, Math.floor(line)))
      const block = view.lineBlockAt(doc.line(ln).from)
      return block.top + clamp01(line - ln) * block.height + view.documentPadding.top
    }

    const muteUntil = { editor: 0, preview: 0 }
    const SUPPRESS_MS = 150
    const write = (el: HTMLElement, key: 'editor' | 'preview', top: number) => {
      // Skip no-op writes: writing fires no scroll event, so arming a mute here would only swallow the
      // follower's next genuine user scroll.
      if (Math.abs(el.scrollTop - top) <= 0.5) return
      muteUntil[key] = performance.now() + SUPPRESS_MS
      el.scrollTop = top
    }

    // Which pane the user last drove. Re-alignment after a reflow follows the driver so we never yank
    // the pane being read. Defaults to 'editor' because typing — the common content-change trigger —
    // is editor-driven, which is what makes the preview track the cursor to the bottom of the doc.
    let driver: 'editor' | 'preview' = 'editor'

    // Editor scrollTop that rests the LAST line at the bottom of the viewport — the editor's "natural"
    // bottom. scrollPastEnd lets it scroll further (last line up toward the top); that extra range is the
    // end-of-doc breathing space, during which the preview just stays pinned at its own bottom. The sync
    // treats [0, nb] ⇆ [0, pMax] and never drives the editor into the slack beyond nb from the preview.
    const editorNaturalBottom = (): number =>
      Math.max(0, view.lineBlockAt(view.state.doc.length).bottom + view.documentPadding.top - editor.clientHeight)

    // Exact-align the extremes (HackMD's tail handling). Pure line-anchoring can't make "one pane at its
    // bottom" mean "the other at its bottom": a viewport of source lines is not a viewport of rendered
    // pixels, so the top lines don't correspond at the ends. Near each extreme we blend toward it; `zone`
    // ≈ one editor line, small enough not to disturb the middle.
    const ZONE = () => view.defaultLineHeight

    const syncFromEditor = () => {
      const nb = editorNaturalBottom()
      const eTop = editor.scrollTop
      const pMax = preview.scrollHeight - preview.clientHeight
      const zone = ZONE()
      let target: number
      if (nb > 0 && eTop >= nb) {
        target = pMax // last line at/above the bottom (incl. the scrollPastEnd slack) → preview pinned
      } else {
        target = previewYForLine(editorTopLine())
        if (eTop < zone) target *= clamp01(eTop / zone) // snap the exact top to the top
        else if (nb > 0 && eTop > nb - zone) target += (pMax - target) * clamp01((eTop - (nb - zone)) / zone)
      }
      write(preview, 'preview', target)
    }
    const syncFromPreview = () => {
      const nb = editorNaturalBottom()
      const pTop = preview.scrollTop
      const pMax = preview.scrollHeight - preview.clientHeight
      const zone = ZONE()
      let target = editorScrollTopForLine(lineForPreviewY(pTop))
      if (pTop < zone) target *= clamp01(pTop / zone) // snap the exact top to the top
      else if (pMax > 0 && pTop > pMax - zone) target += (nb - target) * clamp01((pTop - (pMax - zone)) / zone)
      // The scrollPastEnd slack is reachable only by scrolling the editor itself — never push it there
      // from the preview, so the preview's bottom maps to the editor's natural bottom, not its raw max.
      write(editor, 'editor', Math.min(target, nb))
    }

    const onEditorScroll = () => {
      if (performance.now() < muteUntil.editor) return
      driver = 'editor'
      if (dirty) buildMap()
      syncFromEditor()
    }
    const onPreviewScroll = () => {
      if (performance.now() < muteUntil.preview) return
      driver = 'preview'
      if (dirty) buildMap()
      syncFromPreview()
    }
    const onEditorTouch = () => { driver = 'editor'; muteUntil.editor = 0; muteUntil.preview = performance.now() + SUPPRESS_MS }
    const onPreviewTouch = () => { driver = 'preview'; muteUntil.preview = 0; muteUntil.editor = performance.now() + SUPPRESS_MS }

    // Re-renders (typing, debounced), image loads and reflow change block offsets. Rebuild the map and
    // re-align from the driving pane so the two never drift — in particular, appending text keeps the
    // preview pinned to the bottom alongside the editor. rAF-coalesced; only scrollTop is written (never
    // size), so the observer can't loop.
    let resyncRaf = 0
    const ro = new ResizeObserver(() => {
      dirty = true
      if (resyncRaf) return
      resyncRaf = requestAnimationFrame(() => {
        resyncRaf = 0
        buildMap()
        if (driver === 'preview') syncFromPreview()
        else syncFromEditor()
      })
    })
    ro.observe(preview)
    const content = preview.querySelector('.md')
    if (content) ro.observe(content)

    editor.addEventListener('scroll', onEditorScroll, { passive: true })
    preview.addEventListener('scroll', onPreviewScroll, { passive: true })
    editor.addEventListener('touchstart', onEditorTouch, { passive: true })
    preview.addEventListener('touchstart', onPreviewTouch, { passive: true })
    return () => {
      ro.disconnect()
      if (resyncRaf) cancelAnimationFrame(resyncRaf)
      editor.removeEventListener('scroll', onEditorScroll)
      preview.removeEventListener('scroll', onPreviewScroll)
      editor.removeEventListener('touchstart', onEditorTouch)
      preview.removeEventListener('touchstart', onPreviewTouch)
    }
  }, [enabled, view, preview])
}
