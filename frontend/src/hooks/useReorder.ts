import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { treeKeys, useTree, type DocMeta } from './useTree'
import { persistOrder } from '../lib/order'
import { toast } from '../lib/toast'
import type { Folder } from '../lib/types'

// Re-sort a cached tree list after siblings' sort_order changed. The list arrives in the server's
// (sort_order, name/title) order and JS sort is stable, so sorting by sort_order alone keeps every
// untouched sibling (and other projects/folders in the same global list) exactly where it was.
function resort<T extends { id: string; sort_order: number }>(list: T[], order: Map<string, number>): T[] {
  const next = list.map((it) => (order.has(it.id) ? { ...it, sort_order: order.get(it.id)! } : it))
  return [...next].sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * Commit a finished reorder. `ordered` is the sibling list in its FINAL order (the drag already happened
 * live, so this is just persistence): we stamp each row's new index as sort_order in the React Query
 * cache so the committed order matches the working one, then write it to the DB. On failure we refetch to
 * roll back and toast.
 */
export function useReorder() {
  const qc = useQueryClient()
  const { refresh } = useTree()
  return useCallback(
    async (table: 'folders' | 'documents', ordered: { id: string; sort_order: number }[]) => {
      const order = new Map(ordered.map((it, i) => [it.id, i]))
      if (table === 'folders') {
        qc.setQueryData<Folder[]>(treeKeys.folders, (old) => (old ? resort(old, order) : old))
      } else {
        qc.setQueryData<DocMeta[]>(treeKeys.documents, (old) => (old ? resort(old, order) : old))
      }
      try {
        await persistOrder(table, ordered)
      } catch (e) {
        await refresh()
        toast('error', e instanceof Error ? e.message : 'Could not save the new order')
      }
    },
    [qc, refresh],
  )
}
