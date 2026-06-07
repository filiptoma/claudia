import { useState } from 'react'
import { Check, MoreHorizontal, Pencil, Trash2, Undo2, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '../../lib/toast'
import Byline from './Byline'
import Composer from './Composer'
import MessageList from './MessageList'
import DiffView from './DiffView'
import SuggestionComposer from './SuggestionComposer'
import type { AnnotationActions } from '../../hooks/useAnnotations'
import type { SuggestionMessage, SuggestionThread } from '../../lib/types'

// A suggested edit, rendered identically in the floating window and the sidebar list. Lifecycle:
// while pending, an editor/owner approves (applies it) or rejects it, and the author may edit/withdraw
// their own; once resolved (accepted/rejected) it's kept for review and an editor/owner can delete it.
export default function SuggestionCard({
  suggestion,
  messages,
  projectId,
  uid,
  canEdit,
  actions,
  variant,
  selected = false,
  orphaned = false,
  onSelect,
}: {
  suggestion: SuggestionThread
  messages: SuggestionMessage[]
  projectId: string
  uid: string | null
  canEdit: boolean
  actions: AnnotationActions
  variant: 'floating' | 'list'
  selected?: boolean
  orphaned?: boolean
  onSelect?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const isAuthor = !!uid && suggestion.author === uid
  const pending = suggestion.status === 'pending'
  // Once accepted/rejected the thread is read-only: no replies, no edits — only delete.
  const canReply = !!uid && pending

  const run = async (fn: () => Promise<void>, ok?: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      if (ok) toast('success', ok)
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const hasActions = (pending && (canEdit || isAuthor)) || (!pending && canEdit)
  const actionsMenu = hasActions ? (
    // Non-modal so it doesn't make the desktop annotation popover behind it inert (a modal menu sets
    // body pointer-events:none, which would make clicking back into the popover dismiss it).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Suggestion actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {pending && canEdit && (
          <DropdownMenuItem variant="success" onSelect={() => run(() => actions.approve(suggestion.id), 'Suggestion applied')}>
            <Check className="size-4" /> Approve
          </DropdownMenuItem>
        )}
        {pending && canEdit && (
          <DropdownMenuItem variant="destructive" onSelect={() => run(() => actions.reject(suggestion.id), 'Suggestion rejected')}>
            <X className="size-4" /> Reject
          </DropdownMenuItem>
        )}
        {pending && isAuthor && (
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-4" /> Edit
          </DropdownMenuItem>
        )}
        {pending && isAuthor && (
          <DropdownMenuItem variant="destructive" onSelect={() => run(() => actions.withdraw(suggestion.id), 'Suggestion withdrawn')}>
            <Undo2 className="size-4" /> Withdraw
          </DropdownMenuItem>
        )}
        {!pending && canEdit && (
          <DropdownMenuItem variant="destructive" onSelect={() => run(() => actions.deleteSuggestion(suggestion.id))}>
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  const footer =
    canReply || actionsMenu ? (
      <div className="mt-3">
        {canReply ? (
          <Composer
            projectId={projectId}
            submitLabel="Reply"
            placeholder="Reply…  (@ to mention)"
            minRows={1}
            iconOnly
            leading={actionsMenu}
            busy={busy}
            onSubmit={(body, mentions) => run(() => actions.replySuggestion(suggestion.id, body, mentions))}
          />
        ) : (
          <div className="flex">{actionsMenu}</div>
        )}
      </div>
    ) : null

  const statusBadge =
    suggestion.status === 'accepted' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-emerald-600 dark:text-emerald-400">
        <Check className="size-3" /> Accepted
      </span>
    ) : suggestion.status === 'rejected' ? (
      <span className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
        Rejected
      </span>
    ) : orphaned ? (
      <span
        className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground"
        title="The text this suggestion was attached to has changed."
      >
        Orphaned
      </span>
    ) : null

  const inner = (
    <>
      <Byline
        authorId={suggestion.author}
        avatarSeed={suggestion.id}
        name={suggestion.author_name}
        avatarUrl={suggestion.author_avatar_url}
        action="suggested an edit"
        at={suggestion.created_at}
      />
      {statusBadge && <div className="mt-1.5">{statusBadge}</div>}
      {editing ? (
        <div className="mt-2">
          <SuggestionComposer
            projectId={projectId}
            originalMd={suggestion.original_md}
            suggestedMd={suggestion.suggested_md}
            editable
            submitLabel="Save"
            submitIcon={<Check className="size-3.5" />}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSubmit={(suggestedMd) =>
              run(async () => {
                await actions.editSuggestion(suggestion.id, suggestedMd)
                setEditing(false)
              })
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-2">
            <DiffView original={suggestion.original_md} suggested={suggestion.suggested_md} />
          </div>
          {messages.length > 0 && (
            <div className="mt-3">
              <MessageList
                messages={messages}
                uid={uid}
                canDelete={canEdit}
                readOnly={!pending}
                onDelete={(id) => actions.deleteSuggestionMessage(id)}
              />
            </div>
          )}
          {footer}
        </>
      )}
    </>
  )

  if (variant === 'floating') return <div>{inner}</div>

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onFocus={onSelect}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect?.()
        }
      }}
      className={cn(
        'cursor-pointer rounded-xl border bg-card p-3 text-left shadow-sm transition-colors',
        selected ? 'border-accent2 ring-1 ring-accent2/40' : 'border-border hover:border-accent2/40',
        !pending && 'opacity-80',
      )}
    >
      {inner}
    </div>
  )
}
