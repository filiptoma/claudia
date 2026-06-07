import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { AvatarCircle } from '../ProfileAvatar'
import { toast } from '../../lib/toast'
import MentionText from './MentionText'
import { relativeTime } from './format'
import type { DisplayMessage } from './format'

// The list of messages in a thread (comment replies, or a suggestion's note + replies). A message
// can be deleted by its author or by an editor/owner (`canDelete`).
export default function MessageList({
  messages,
  uid,
  canDelete,
  readOnly = false,
  onDelete,
}: {
  messages: DisplayMessage[]
  uid: string | null
  canDelete: boolean
  /** Resolved threads are read-only — suppress all delete affordances. */
  readOnly?: boolean
  onDelete: (id: string) => Promise<void>
}) {
  return (
    <ul className="flex flex-col gap-3">
      {messages.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          deletable={!readOnly && ((!!uid && m.author === uid) || canDelete)}
          onDelete={() => onDelete(m.id)}
        />
      ))}
    </ul>
  )
}

function MessageRow({
  message,
  deletable,
  onDelete,
}: {
  message: DisplayMessage
  deletable: boolean
  onDelete: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onDelete()
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="group flex gap-2">
      <AvatarCircle
        userId={message.author ?? message.id}
        name={message.author_name}
        email={null}
        avatarUrl={message.author_avatar_url}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{message.author_name ?? 'Unknown user'}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(message.created_at)}</span>
          {deletable && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              aria-label="Delete comment"
              className="ml-auto shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100 disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
        <MentionText body={message.body} />
      </div>
    </li>
  )
}
