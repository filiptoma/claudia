import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pb'
import type { DocumentRec, Folder, Project } from '../lib/types'

// Sidebar document metadata — everything except the (potentially large) markdown content.
export type DocMeta = Pick<DocumentRec, 'id' | 'title' | 'slug' | 'project' | 'folder' | 'order'>

const DOC_FIELDS = 'id,title,slug,project,folder,order'

export const treeKeys = {
  projects: ['projects'] as const,
  folders: ['folders'] as const,
  documents: ['documents'] as const,
  document: (id: string) => ['document', id] as const,
}

export const fetchDocument = (id: string) =>
  pb.collection('documents').getOne<DocumentRec>(id, { requestKey: null })

/** Projects + folders + document metadata for the sidebar tree. Cached & deduped by TanStack Query. */
export function useTree() {
  const qc = useQueryClient()
  const projects = useQuery({
    queryKey: treeKeys.projects,
    queryFn: () => pb.collection('projects').getFullList<Project>({ sort: 'order,name', requestKey: null }),
  })
  const folders = useQuery({
    queryKey: treeKeys.folders,
    queryFn: () => pb.collection('folders').getFullList<Folder>({ sort: 'order,name', requestKey: null }),
  })
  const documents = useQuery({
    queryKey: treeKeys.documents,
    queryFn: () =>
      pb.collection('documents').getFullList<DocMeta>({ sort: 'order,title', fields: DOC_FIELDS, requestKey: null }),
  })

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: treeKeys.projects }),
      qc.invalidateQueries({ queryKey: treeKeys.folders }),
      qc.invalidateQueries({ queryKey: treeKeys.documents }),
    ])

  return {
    projects: projects.data ?? [],
    folders: folders.data ?? [],
    documents: documents.data ?? [],
    loading: projects.isPending || folders.isPending || documents.isPending,
    error: (projects.error || folders.error || documents.error) as Error | null,
    refresh,
  }
}

/** A single document's full record (incl. content). Cached so revisits are instant — no loading flash. */
export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: id ? treeKeys.document(id) : ['document', '__none__'],
    queryFn: () => fetchDocument(id as string),
    enabled: !!id,
    // Explicitly cached for 5 min (overrides the global staleTime:0). Content rarely changes
    // out-of-band, and our own edits are pushed into the cache via setQueryData on save — so
    // navigating back to a document is instant and does not refetch.
    staleTime: 5 * 60 * 1000,
  })
}
