import { createContext, useContext } from 'react'
import type { RefObject } from 'react'
import type { CommentMessage, CommentThread, SuggestionMessage, SuggestionThread } from '../lib/types'
import type { AnnotationActions } from '../hooks/useAnnotations'
import type { ListMode } from '../hooks/useAnnotationLayout'
import type { Capture } from '../lib/anchor'

export const DRAFT_KEY = '__draft__'

export interface Draft {
  kind: 'comment' | 'suggestion'
  capture: Capture
  range: Range
  top: number
}

/** A Floating-UI virtual element tracking the active annotation's rendered rect (for the desktop
 *  popover). `contextElement` lets autoUpdate find the right scroll ancestors to follow. */
export interface VirtualAnchor {
  getBoundingClientRect: () => DOMRect
  contextElement?: Element
}

export interface AnnotationContextValue {
  // data
  docId: string
  projectId: string
  content: string
  threads: CommentThread[]
  messagesByThread: Map<string, CommentMessage[]>
  suggestions: SuggestionThread[]
  messagesBySuggestion: Map<string, SuggestionMessage[]>
  actions: AnnotationActions

  // permissions
  uid: string | null
  canEdit: boolean
  canComment: boolean

  // selection / active state
  activeKey: string | null
  activate: (key: string) => void
  deactivate: () => void

  // sidebar
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  /** Close the sidebar AND clear the current selection (so nothing stays highlighted / no floating
   *  window pops for the previously-selected item). */
  closeSidebar: () => void

  // desktop floating window: fixed viewport `top` (px), set by the host so the window clears the
  // app header + the rendered-markdown toolbar.
  floatingTop: number

  // desktop popover anchoring: the active annotation's rendered rect (virtual anchor) and the scroll
  // container the popover must stay within (read-mode view area / split-mode preview pane).
  anchorRef: RefObject<VirtualAnchor>
  boundaryEl: Element | null
  /** The rendered-markdown container — clicks inside it are handled by the doc click logic (select /
   *  dismiss), so the popover treats them as in-bounds rather than auto-closing. */
  docEl: HTMLElement | null

  // count of unresolved comments + pending suggestions (the toolbar badge / review count)
  pendingCount: number

  // draft (new comment/suggestion in progress)
  draft: Draft | null
  startDraft: (kind: 'comment' | 'suggestion', capture: Capture, range: Range, top: number) => void
  cancelDraft: () => void
  submitComment: (body: string, mentions: string[]) => Promise<void>
  submitSuggestion: (suggestedMd: string, note: string, mentions: string[]) => Promise<void>

  // geometry: annotation id → y-offset from doc top (null = orphaned)
  placements: Record<string, number | null>

  busy: boolean

  // resolved responsive layout for the list (see useAnnotationLayout): right-rail sidebar, or a
  // full-height bottom sheet on mobile / portrait-tablet widths.
  listMode: ListMode
}

const AnnotationContext = createContext<AnnotationContextValue | null>(null)

export { AnnotationContext }

// eslint-disable-next-line react-refresh/only-export-components
export function useAnnotationCtx(): AnnotationContextValue {
  const ctx = useContext(AnnotationContext)
  if (!ctx) throw new Error('useAnnotationCtx must be inside AnnotationLayer')
  return ctx
}
