import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { extractStoragePaths, signImages } from '../lib/storage'
import type { DocumentRec, Folder, Project, ProjectMember } from '../lib/types'

export type DocMeta = Pick<
  DocumentRec,
  | 'id'
  | 'title'
  | 'slug'
  | 'project_id'
  | 'folder_id'
  | 'sort_order'
  | 'is_quick_note'
  | 'created_at'
  | 'updated_at'
>

export const treeKeys = {
  projects: ['projects'] as const,
  folders: ['folders'] as const,
  documents: ['documents'] as const,
  members: ['members'] as const,
  document: (id: string) => ['document', id] as const,
}

export async function fetchDocument(id: string): Promise<DocumentRec> {
  const { data, error } = await supabase.from('documents').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data as DocumentRec
}

// Tree lists are cached (staleTime) and kept fresh by explicit invalidation after every CRUD
// (see refresh()), so navigating between pages doesn't refetch them on every mount.
const TREE_STALE = 5 * 60 * 1000

// Projects + folders + document metadata + the membership rows the user is allowed to see.
// RLS filters all of these, so a user only ever gets back what they're permitted to read.
export function useTree() {
  const qc = useQueryClient()

  const projects = useQuery({
    queryKey: treeKeys.projects,
    staleTime: TREE_STALE,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').order('sort_order').order('name')
      if (error) throw new Error(error.message)
      return data as Project[]
    },
  })
  const folders = useQuery({
    queryKey: treeKeys.folders,
    staleTime: TREE_STALE,
    queryFn: async () => {
      const { data, error } = await supabase.from('folders').select('*').order('sort_order').order('name')
      if (error) throw new Error(error.message)
      return data as Folder[]
    },
  })
  const documents = useQuery({
    queryKey: treeKeys.documents,
    staleTime: TREE_STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('id,title,slug,project_id,folder_id,sort_order,is_quick_note,created_at,updated_at')
        .order('sort_order')
        .order('title')
      if (error) throw new Error(error.message)
      return data as DocMeta[]
    },
  })
  const members = useQuery({
    queryKey: treeKeys.members,
    staleTime: TREE_STALE,
    queryFn: async () => {
      const { data, error } = await supabase.from('project_members').select('*')
      if (error) throw new Error(error.message)
      return data as ProjectMember[]
    },
  })

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: treeKeys.projects }),
      qc.invalidateQueries({ queryKey: treeKeys.folders }),
      qc.invalidateQueries({ queryKey: treeKeys.documents }),
      qc.invalidateQueries({ queryKey: treeKeys.members }),
    ])

  return {
    projects: projects.data ?? [],
    folders: folders.data ?? [],
    documents: documents.data ?? [],
    members: members.data ?? [],
    loading: projects.isPending || folders.isPending || documents.isPending || members.isPending,
    error: (projects.error || folders.error || documents.error || members.error) as Error | null,
    // Raw query objects for <QuerySuspense> (loading/error gating per section).
    queries: [projects, folders, documents, members],
    refresh,
  }
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: id ? treeKeys.document(id) : ['document', '__none__'],
    queryFn: () => fetchDocument(id as string),
    enabled: !!id,
    // Explicitly cached (overrides global staleTime:0): edits are pushed via setQueryData on save.
    staleTime: 5 * 60 * 1000,
  })
}

const EMPTY_IMAGES: Record<string, string> = {}

// Resolve the `storage:` image references in a document to signed URLs (private bucket).
// Keyed by the set of paths, so typing text doesn't re-sign — only adding/removing an image does.
export function useSignedImages(content: string): Record<string, string> {
  const paths = extractStoragePaths(content)
  const key = paths.slice().sort().join('|')
  const q = useQuery({
    queryKey: ['signed-images', key],
    queryFn: () => signImages(paths),
    enabled: paths.length > 0,
    staleTime: 50 * 60 * 1000,
  })
  return q.data ?? EMPTY_IMAGES
}
