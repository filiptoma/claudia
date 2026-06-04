import { create } from 'zustand'

// Shared autosave status for the active editor, surfaced in the app bar (AppHeader) rather than the
// editor toolbar. The Editor writes to it; the header's <SaveIndicator/> reads it. Reset on unmount
// so non-editor pages don't show a stale "Saved".
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

type SaveStatusState = {
  status: SaveStatus
  savedAt: Date | null
  retry: (() => void) | null
  set: (next: Partial<Pick<SaveStatusState, 'status' | 'savedAt' | 'retry'>>) => void
  reset: () => void
}

export const useSaveStatus = create<SaveStatusState>((set) => ({
  status: 'idle',
  savedAt: null,
  retry: null,
  set: (next) => set(next),
  reset: () => set({ status: 'idle', savedAt: null, retry: null }),
}))
