import { useMemo } from 'react'
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
  deleteSuggestion,
  deleteSuggestionComment,
  editComment,
  editSuggestion,
  findMentionableByEmail,
  listDocumentCommentThreads,
  listDocumentComments,
  listDocumentSuggestionComments,
  listDocumentSuggestions,
  listMentionableUsers,
  rejectSuggestion,
  setThreadResolved,
  withdrawSuggestion,
} from '../lib/crud'
import type {
  Anchor,
  CommentMessage,
  CommentThread,
  MentionableUser,
  SuggestionMessage,
  SuggestionThread,
} from '../lib/types'

// Annotations are refresh-based (no realtime, per v1): React Query fetches on open and every mutation
// invalidates the relevant keys so the next read reflects the change.
export const annotationKeys = {
  mentionables: (projectId: string) => ['mentionables', projectId] as const,
  commentThreads: (documentId: string) => ['comment-threads', documentId] as const,
  comments: (documentId: string) => ['comments', documentId] as const,
  suggestions: (documentId: string) => ['suggestions', documentId] as const,
  suggestionComments: (documentId: string) => ['suggestion-comments', documentId] as const,
}

const STALE = 60 * 1000

export function useMentionableUsers(projectId: string | undefined): MentionableUser[] {
  const q = useQuery({
    queryKey: annotationKeys.mentionables(projectId ?? '__none__'),
    queryFn: () => listMentionableUsers(projectId as string),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  })
  return q.data ?? []
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Resolve a fully-typed email to a mention target — lets an author @mention someone who isn't a
// project member (allowed on public projects). Only fires once the query is a complete email.
export function useMentionableByEmail(projectId: string | undefined, query: string): MentionableUser | null {
  const email = query.trim().toLowerCase()
  const q = useQuery({
    queryKey: ['mention-email', projectId ?? '__none__', email],
    queryFn: () => findMentionableByEmail(projectId as string, email),
    enabled: !!projectId && EMAIL_RE.test(email),
    staleTime: 5 * 60 * 1000,
  })
  return q.data ?? null
}

export interface DocumentComments {
  threads: CommentThread[]
  messages: CommentMessage[]
  messagesByThread: Map<string, CommentMessage[]>
  loading: boolean
  error: Error | null
}

export function useDocumentComments(documentId: string | undefined): DocumentComments {
  const threadsQ = useQuery({
    queryKey: annotationKeys.commentThreads(documentId ?? '__none__'),
    queryFn: () => listDocumentCommentThreads(documentId as string),
    enabled: !!documentId,
    staleTime: STALE,
  })
  const messagesQ = useQuery({
    queryKey: annotationKeys.comments(documentId ?? '__none__'),
    queryFn: () => listDocumentComments(documentId as string),
    enabled: !!documentId,
    staleTime: STALE,
  })
  const messages = useMemo(() => messagesQ.data ?? [], [messagesQ.data])
  const messagesByThread = useMemo(() => {
    const map = new Map<string, CommentMessage[]>()
    for (const m of messages) {
      const list = map.get(m.thread_id)
      if (list) list.push(m)
      else map.set(m.thread_id, [m])
    }
    return map
  }, [messages])
  return {
    threads: threadsQ.data ?? [],
    messages,
    messagesByThread,
    loading: threadsQ.isPending || messagesQ.isPending,
    error: (threadsQ.error || messagesQ.error) as Error | null,
  }
}

export interface DocumentSuggestions {
  suggestions: SuggestionThread[]
  messages: SuggestionMessage[]
  messagesBySuggestion: Map<string, SuggestionMessage[]>
  loading: boolean
  error: Error | null
}

export function useDocumentSuggestions(documentId: string | undefined): DocumentSuggestions {
  const suggestionsQ = useQuery({
    queryKey: annotationKeys.suggestions(documentId ?? '__none__'),
    queryFn: () => listDocumentSuggestions(documentId as string),
    enabled: !!documentId,
    staleTime: STALE,
  })
  const messagesQ = useQuery({
    queryKey: annotationKeys.suggestionComments(documentId ?? '__none__'),
    queryFn: () => listDocumentSuggestionComments(documentId as string),
    enabled: !!documentId,
    staleTime: STALE,
  })
  const messages = useMemo(() => messagesQ.data ?? [], [messagesQ.data])
  const messagesBySuggestion = useMemo(() => {
    const map = new Map<string, SuggestionMessage[]>()
    for (const m of messages) {
      const list = map.get(m.suggestion_id)
      if (list) list.push(m)
      else map.set(m.suggestion_id, [m])
    }
    return map
  }, [messages])
  return {
    suggestions: suggestionsQ.data ?? [],
    messages,
    messagesBySuggestion,
    loading: suggestionsQ.isPending || messagesQ.isPending,
    error: (suggestionsQ.error || messagesQ.error) as Error | null,
  }
}

// Unresolved comment threads + pending suggestions, for the View-mode "needs review" badge. Reuses
// the same query keys as the full hooks, so it dedupes when the panel is also open.
export function useUnresolvedAnnotationCount(documentId: string | undefined): number {
  const threadsQ = useQuery({
    queryKey: annotationKeys.commentThreads(documentId ?? '__none__'),
    queryFn: () => listDocumentCommentThreads(documentId as string),
    enabled: !!documentId,
    staleTime: STALE,
  })
  const suggestionsQ = useQuery({
    queryKey: annotationKeys.suggestions(documentId ?? '__none__'),
    queryFn: () => listDocumentSuggestions(documentId as string),
    enabled: !!documentId,
    staleTime: STALE,
  })
  const unresolvedThreads = (threadsQ.data ?? []).filter((t) => !t.resolved).length
  const pendingSuggestions = (suggestionsQ.data ?? []).length
  return unresolvedThreads + pendingSuggestions
}

// All annotation mutations, each wired to invalidate the keys it affects. Approving a suggestion also
// invalidates the document query so the rendered content reflects the applied edit.
export function useAnnotationActions(documentId: string) {
  const qc = useQueryClient()
  const { uid } = useAuth()

  const refreshComments = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: annotationKeys.commentThreads(documentId) }),
      qc.invalidateQueries({ queryKey: annotationKeys.comments(documentId) }),
    ])
  const refreshSuggestions = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: annotationKeys.suggestions(documentId) }),
      qc.invalidateQueries({ queryKey: annotationKeys.suggestionComments(documentId) }),
    ])

  const requireUid = (): string => {
    if (!uid) throw new Error('You must be signed in.')
    return uid
  }

  return {
    async createThread(args: {
      anchor: Anchor
      sourceStart: number
      sourceEnd: number
      body: string
      mentions: string[]
    }): Promise<void> {
      await createCommentThread({ documentId, ...args })
      await refreshComments()
    },
    async reply(threadId: string, body: string, mentions: string[]): Promise<void> {
      await addComment(threadId, requireUid(), body, mentions)
      await refreshComments()
    },
    async editMessage(commentId: string, body: string, mentions: string[]): Promise<void> {
      await editComment(commentId, body, mentions)
      await refreshComments()
    },
    async setResolved(threadId: string, resolved: boolean): Promise<void> {
      await setThreadResolved(threadId, resolved, uid)
      await refreshComments()
    },
    async deleteThread(threadId: string): Promise<void> {
      await deleteCommentThread(threadId)
      await refreshComments()
    },
    async deleteMessage(commentId: string): Promise<void> {
      await deleteComment(commentId)
      await refreshComments()
    },
    async createSuggestion(args: {
      anchor: Anchor
      sourceStart: number
      sourceEnd: number
      originalMd: string
      suggestedMd: string
      note: string
      mentions: string[]
    }): Promise<void> {
      await createSuggestion({ documentId, ...args })
      await refreshSuggestions()
    },
    async replySuggestion(suggestionId: string, body: string, mentions: string[]): Promise<void> {
      await addSuggestionComment(suggestionId, requireUid(), body, mentions)
      await refreshSuggestions()
    },
    async editSuggestion(suggestionId: string, suggestedMd: string): Promise<void> {
      await editSuggestion(suggestionId, suggestedMd)
      await refreshSuggestions()
    },
    // Approve applies the edit to the document AND marks the suggestion accepted; invalidating the
    // document query makes the new content show immediately (read view + the tree listing).
    async approve(suggestionId: string): Promise<void> {
      await approveSuggestion(suggestionId)
      await Promise.all([
        refreshSuggestions(),
        qc.invalidateQueries({ queryKey: treeKeys.document(documentId) }),
      ])
    },
    async reject(suggestionId: string): Promise<void> {
      await rejectSuggestion(suggestionId)
      await refreshSuggestions()
    },
    async withdraw(suggestionId: string): Promise<void> {
      await withdrawSuggestion(suggestionId)
      await refreshSuggestions()
    },
    async deleteSuggestion(suggestionId: string): Promise<void> {
      await deleteSuggestion(suggestionId)
      await refreshSuggestions()
    },
    async deleteSuggestionMessage(commentId: string): Promise<void> {
      await deleteSuggestionComment(commentId)
      await refreshSuggestions()
    },
  }
}

export type AnnotationActions = ReturnType<typeof useAnnotationActions>
