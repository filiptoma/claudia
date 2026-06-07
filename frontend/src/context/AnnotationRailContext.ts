import { createContext, useContext } from 'react'

export interface AnnotationRailApi {
  /** True while the docked comments/suggestions rail (listMode === 'sidebar') is open. The layout
   *  reserves its width so the document content shifts instead of being covered. */
  open: boolean
  /** Published by the annotation engine to mirror its sidebar open state up to the layout. */
  setOpen: (open: boolean) => void
}

// Lives in its own module so the provider (AppLayout) and the consumer (the annotation engine, deep in
// the document page) can share it without a circular dependency. Defaults to a no-op so the engine works
// outside the app shell (e.g. tests) without reserving any space.
export const AnnotationRailContext = createContext<AnnotationRailApi>({
  open: false,
  setOpen: () => {},
})

export function useAnnotationRail(): AnnotationRailApi {
  return useContext(AnnotationRailContext)
}
