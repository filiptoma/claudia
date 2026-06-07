import { createContext, useContext } from 'react'

export interface AnnotationRailApi {
  /** In-flow DOM slot (a flex sibling of the main content, owned by AppLayout) that the document page
   *  portals the docked comments/suggestions rail into — so the rail sits in normal flow and shifts the
   *  content aside, exactly like the nav sidebar, rather than floating over it. Null until mounted. */
  slot: HTMLElement | null
}

// Lives in its own module so the provider (AppLayout) and the consumer (AnnotationSidebar, deep in the
// document page) can share it without a circular dependency. Defaults to no slot, so the rail simply
// doesn't render outside the app shell (e.g. tests) rather than crashing.
export const AnnotationRailContext = createContext<AnnotationRailApi>({ slot: null })

export function useAnnotationRail(): AnnotationRailApi {
  return useContext(AnnotationRailContext)
}
