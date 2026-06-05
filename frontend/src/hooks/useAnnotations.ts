import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { treeKeys } from './useTree'
import {
  addComment,
  addSuggestionComment,
  approveSuggestion,
  createCommentThread,
  createSuggestion,
  deleteComment,
  deleteCommentThread,
  deleteSuggestionComment,
  listDocumentCommentThreads,
  listDocumentComments,
  listDocumentSuggestionComments,
  listDocumentSuggestions,
  listMentionableUsers,
  rejectSuggestion,
  setThreadResolved,
} from '../lib/crud'
import type { Anchor } from '../lib/types'

export const annotationKeys = {
  commentThreads: (docId: string) => ['comment-threads', docId] as const,
  comments: (docId: string) => ['comments', docId] as const,
  suggestions: (docId: string) => ['suggestions', docId] as const,
  suggestionComments: (docId: string) => ['suggestion-comments', docId] as const,
  mentionables: (projectId: string) => ['mentionables', projectId] as const,
}

const FRESH = 0 // refresh-based v1: always refetch on mount / after invalidation

// @mention candidates for a project (owner + members). Cached briefly — membership changes rarely.
export function useMentionableUsers(projectId: string | undefined) {
  return useQuery({
    queryKey: annotationKeys.mentionables(projectId ?? '__none__'),
    queryFn: () => listMentionableUsers(projectId as string),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  })
}

// All comment threads + messages for a document.
export function useDocumentComments(documentId: string) {
  const threads = useQuery({
    queryKey: annotationKeys.commentThreads(documentId),
    queryFn: () => listDocumentCommentThreads(documentId),
    staleTime: FRESH,
  })
  const messages = useQuery({
    queryKey: annotationKeys.comments(documentId),
    queryFn: () => listDocumentComments(documentId),
    staleTime: FRESH,
  })
  return {
    threads: threads.data ?? [],
    messages: messages.data ?? [],
    loading: threads.isPending || messages.isPending,
    error: (threads.error || messages.error) as Error | null,
  }
}

// All suggestion threads + replies for a document.
export function useDocumentSuggestions(documentId: string) {
  const suggestions = useQuery({
    queryKey: annotationKeys.suggestions(documentId),
    queryFn: () => listDocumentSuggestions(documentId),
    staleTime: FRESH,
  })
  const messages = useQuery({
    queryKey: annotationKeys.suggestionComments(documentId),
    queryFn: () => listDocumentSuggestionComments(documentId),
    staleTime: FRESH,
  })
  return {
    suggestions: suggestions.data ?? [],
    messages: messages.data ?? [],
    loading: suggestions.isPending || messages.isPending,
    error: (suggestions.error || messages.error) as Error | null,
  }
}

// Mutations with the right invalidation baked in, so UI components don't have to wire keys.
export function useAnnotationActions(documentId: string) {
  const qc = useQueryClient()
  const { uid } = useAuth()

  const invalidate = (...keys: readonly (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })))

  const comments = () => invalidate(annotationKeys.commentThreads(documentId), annotationKeys.comments(documentId))
  const suggestions = () =>
    invalidate(annotationKeys.suggestions(documentId), annotationKeys.suggestionComments(documentId))

  return {
    // comments
    async createThread(input: { anchor: Anchor; sourceStart: number; sourceEnd: number; body: string; mentions: string[] }) {
      await createCommentThread({ documentId, ...input })
      await comments()
    },
    async reply(threadId: string, body: string, mentions: string[]) {
      if (!uid) throw new Error('Not signed in')
      await addComment(threadId, uid, body, mentions)
      await invalidate(annotationKeys.comments(documentId))
    },
    async resolve(threadId: string, resolved: boolean) {
      if (!uid) throw new Error('Not signed in')
      await setThreadResolved(threadId, resolved, uid)
      await invalidate(annotationKeys.commentThreads(documentId))
    },
    async removeThread(threadId: string) {
      await deleteCommentThread(threadId)
      await comments()
    },
    async removeComment(id: string) {
      await deleteComment(id)
      await invalidate(annotationKeys.comments(documentId))
    },
    // suggestions
    async createSuggestion(input: {
      anchor: Anchor
      sourceStart: number
      sourceEnd: number
      originalMd: string
      suggestedMd: string
      note: string
      mentions: string[]
    }) {
      await createSuggestion({ documentId, ...input })
      await suggestions()
    },
    async replySuggestion(suggestionId: string, body: string, mentions: string[]) {
      if (!uid) throw new Error('Not signed in')
      await addSuggestionComment(suggestionId, uid, body, mentions)
      await invalidate(annotationKeys.suggestionComments(documentId))
    },
    async approve(suggestionId: string) {
      await approveSuggestion(suggestionId)
      // The document content changed: refresh it and the suggestion lists.
      await invalidate(treeKeys.document(documentId), annotationKeys.suggestions(documentId), annotationKeys.suggestionComments(documentId))
    },
    async reject(suggestionId: string) {
      await rejectSuggestion(suggestionId)
      await suggestions()
    },
    async removeSuggestionComment(id: string) {
      await deleteSuggestionComment(id)
      await invalidate(annotationKeys.suggestionComments(documentId))
    },
  }
}
