import { supabase } from './supabase'

type Table = 'projects' | 'folders' | 'documents'

// Next sort_order = (max among matching siblings) + 1, so new items append to the end.
export async function nextOrder(
  table: Table,
  filter?: { project_id?: string; folder_id?: string | null },
): Promise<number> {
  let q = supabase.from(table).select('sort_order').order('sort_order', { ascending: false }).limit(1)
  if (filter?.project_id) q = q.eq('project_id', filter.project_id)
  if (filter && 'folder_id' in filter) {
    q = filter.folder_id ? q.eq('folder_id', filter.folder_id) : q.is('folder_id', null)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const top = data?.[0] as { sort_order?: number } | undefined
  return (top?.sort_order ?? 0) + 1
}

// Persist a drag-reordered sibling list: assign each row its new index as sort_order. Only the rows
// whose position actually changed are written (a contiguous move touches just the shifted slice), so a
// reorder is a handful of small updates, not a full rewrite. The caller passes the siblings in their NEW
// order, each still carrying its CURRENT sort_order — we diff against the target index. Throws on the
// first failed update so the caller can roll the optimistic cache back.
export async function persistOrder(
  table: 'folders' | 'documents',
  ordered: { id: string; sort_order: number }[],
): Promise<void> {
  const writes = ordered
    .map((item, index) => ({ id: item.id, next: index, prev: item.sort_order }))
    .filter((w) => w.prev !== w.next)
  if (writes.length === 0) return
  const results = await Promise.all(
    writes.map((w) => supabase.from(table).update({ sort_order: w.next }).eq('id', w.id)),
  )
  const failed = results.find((r) => r.error)?.error
  if (failed) throw new Error(failed.message)
}
