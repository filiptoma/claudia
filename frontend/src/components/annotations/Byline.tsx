import { Link } from 'react-router-dom'
import { AvatarCircle } from '../ProfileAvatar'
import { formatDateTime } from '../../lib/labels'
import { userProfilePath } from '../../lib/paths'

// The shared header row for an annotation card (comment thread or suggestion): the author avatar, then
// the author name (a link to their profile) with the action ("commented" / "suggested an edit")
// stacked directly beneath it, and the absolute formatted datetime on the right. Used identically in
// the floating window and the sidebar list so both read the same.
export default function Byline({
  authorId,
  avatarSeed,
  name,
  avatarUrl,
  action,
  at,
  trailing,
}: {
  /** Real user id for the profile link; null = anonymous (no link). */
  authorId: string | null
  /** Deterministic avatar-colour seed used when there's no author id. */
  avatarSeed: string
  name: string | null
  avatarUrl: string | null
  action: string
  at: string
  /** Optional node rendered before the datetime (e.g. a "Resolved" / "Orphaned" pill). */
  trailing?: React.ReactNode
}) {
  const displayName = name ?? 'Unknown user'
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <AvatarCircle userId={authorId ?? avatarSeed} name={name} email={null} avatarUrl={avatarUrl} size="sm" />
        <div className="flex min-w-0 flex-col leading-tight">
          {authorId ? (
            <Link
              to={userProfilePath(authorId)}
              onClick={(e) => e.stopPropagation()}
              className="truncate text-sm font-semibold hover:underline"
            >
              {displayName}
            </Link>
          ) : (
            <span className="truncate text-sm font-semibold">{displayName}</span>
          )}
          <span className="truncate text-xs text-muted-foreground">{action}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {trailing}
        <span className="text-xs text-muted-foreground">{formatDateTime(at)}</span>
      </div>
    </div>
  )
}
