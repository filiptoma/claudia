import { create } from 'zustand'

// Touch-only "Change order" mode, toggled from the app-bar ⋯ menu on project/folder pages. While it's
// active, folder/document cards and sidebar rows turn into drag-to-reorder handles and stop navigating;
// turning it off restores normal tap-to-open. Non-touch devices ignore this entirely — they drag
// directly with the pointer. The mode is reset on every navigation (see AppLayout) so it never lingers.
type ReorderModeState = {
  active: boolean
  toggle: () => void
  set: (active: boolean) => void
}

export const useReorderMode = create<ReorderModeState>((set) => ({
  active: false,
  toggle: () => set((s) => ({ active: !s.active })),
  set: (active) => set({ active }),
}))
