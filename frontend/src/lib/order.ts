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
