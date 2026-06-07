import { useState } from 'react'
import { Check, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react'
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
import MentionText from './MentionText'
import type { AnnotationActions } from '../../hooks/useAnnotations'
import type { CommentMessage, CommentThread } from '../../lib/types'

// A comment thread, rendered identically in the floating window (`variant="floating"`) and the sidebar
// list (`variant="list"`, a bordered card whose border turns primary when selected — and the whole
// card selects on click/focus). Lifecycle: anyone who can manage resolves it (that hides it into the
// resolved section); only then can an editor/owner delete it. The author may edit or withdraw their own.
export default function CommentThreadCard({
  thread,
  messages,
  projectId,
  uid,
  canEdit,
  canComment = false,
  actions,
  variant,
  selected = false,
  orphaned = false,
  onSelect,
}: {
  thread: CommentThread
  messages: CommentMessage[]
  projectId: string
  uid: string | null
  canEdit: boolean
  canComment?: boolean
  actions: AnnotationActions
  variant: 'floating' | 'list'
  selected?: boolean
  orphaned?: boolean
  onSelect?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const isAuthor = !!uid && thread.author === uid
  const canManage = canEdit || isAuthor
  // A resolved thread is read-only: no replies, no edits — only reopen / delete.
  const canReply = !!uid && (canEdit || canComment) && !thread.resolved
  // Author may withdraw their own anytime; editors/owners may delete only once it's resolved.
  const canDelete = isAuthor || (canEdit && thread.resolved)

  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const root = messages[0]
  const replies = messages.slice(1)

  const actionsMenu =
    canManage || canDelete ? (
      // Non-modal so it doesn't make the desktop annotation popover behind it inert (a modal menu sets
      // body pointer-events:none, which would make clicking back into the popover dismiss it).
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Comment actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {isAuthor && root && !thread.resolved && (
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </DropdownMenuItem>
          )}
          {canManage && (
            <DropdownMenuItem
              variant={thread.resolved ? 'default' : 'success'}
              onSelect={() => run(() => actions.setResolved(thread.id, !thread.resolved))}
            >
              {thread.resolved ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
              {thread.resolved ? 'Reopen' : 'Resolve'}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onSelect={() => run(() => actions.deleteThread(thread.id))}>
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
            onSubmit={(body, mentions) => run(() => actions.reply(thread.id, body, mentions))}
          />
        ) : (
          <div className="flex">{actionsMenu}</div>
        )}
      </div>
    ) : null

  const badge = thread.resolved ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-link">
      <Check className="size-3" /> Resolved
    </span>
  ) : orphaned ? (
    <span
      className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground"
      title="The text this comment was attached to has changed."
    >
      Orphaned
    </span>
  ) : null

  const inner = (
    <>
      <Byline
        authorId={thread.author}
        avatarSeed={thread.id}
        name={thread.author_name}
        avatarUrl={thread.author_avatar_url}
        action="commented"
        at={thread.created_at}
      />
      {badge && <div className="mt-1.5">{badge}</div>}
      {editing && root ? (
        <div className="mt-2">
          <Composer
            projectId={projectId}
            initialValue={root.body}
            autoFocus
            submitLabel="Save"
            submitIcon={<Check className="size-3.5" />}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSubmit={(body, mentions) =>
              run(async () => {
                await actions.editMessage(root.id, body, mentions)
                setEditing(false)
              })
            }
          />
        </div>
      ) : (
        <>
          {root && (
            <div className="mt-2 text-sm">
              <MentionText body={root.body} />
            </div>
          )}
          {replies.length > 0 && (
            <div className="mt-3">
              <MessageList
                messages={replies}
                uid={uid}
                canDelete={canEdit}
                readOnly={thread.resolved}
                onDelete={(id) => actions.deleteMessage(id)}
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
        selected ? 'border-primary ring-1 ring-primary/40' : 'border-border hover:border-primary/40',
        thread.resolved && 'opacity-80',
      )}
    >
      {inner}
    </div>
  )
}
