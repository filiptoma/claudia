import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { Filter, Sort } from './types'

// Persisted filter & sort state, keyed by a plain `storeKey`. Each key gets its own zustand store
// created exactly once and reused across mounts (mirrors the reference's storeRegistry idea, but
// simplified — no per-user scoping, no migrations).

type FilterStore = {
  filters: Filter[]
  setFilters: (filters: Filter[]) => void
}

type SortStore = {
  sorts: Sort[]
  setSorts: (sorts: Sort[]) => void
}

const filterRegistry = new Map<string, UseBoundStore<StoreApi<FilterStore>>>()
const sortRegistry = new Map<string, UseBoundStore<StoreApi<SortStore>>>()

function createFilterStore(storeKey: string) {
  return create<FilterStore>()(
    persist(
      (set) => ({
        filters: [],
        setFilters: (filters) => set({ filters }),
      }),
      {
        name: `${storeKey}_filter`,
        storage: createJSONStorage(() => localStorage),
      },
    ),
  )
}

function createSortStore(storeKey: string, defaultSort?: Sort[]) {
  return create<SortStore>()(
    persist(
      (set) => ({
        // Seed the default sort on first creation; once persisted it sticks until the user changes it.
        sorts: defaultSort ?? [],
        setSorts: (sorts) => set({ sorts }),
      }),
      {
        name: `${storeKey}_sort`,
        storage: createJSONStorage(() => localStorage),
      },
    ),
  )
}

/** Persisted filter state for a given `storeKey`. The store is created once per key and reused. */
export function useFilterStore(storeKey: string): FilterStore {
  let store = filterRegistry.get(storeKey)
  if (!store) {
    store = createFilterStore(storeKey)
    filterRegistry.set(storeKey, store)
  }
  return store()
}

/**
 * Persisted sort state for a given `storeKey`. `defaultSort` is only applied the first time the
 * store is created (i.e. when there is no persisted value yet).
 */
export function useSortStore(storeKey: string, defaultSort?: Sort[]): SortStore {
  let store = sortRegistry.get(storeKey)
  if (!store) {
    store = createSortStore(storeKey, defaultSort)
    sortRegistry.set(storeKey, store)
  }
  return store()
}
