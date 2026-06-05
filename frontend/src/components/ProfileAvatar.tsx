import { Link } from 'react-router-dom'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { userProfilePath } from '../lib/paths'

// Deterministic background color from userId first char.
const BG_COLORS = [
  'bg-violet-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-orange-500',
]

function colorFor(id: string): string {
  return BG_COLORS[(id.charCodeAt(0) ?? 0) % BG_COLORS.length]
}

function initials(name: string | null, email: string | null, fallback: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }
  if (email) return email.slice(0, 2).toUpperCase()
  return fallback.slice(0, 2).toUpperCase()
}

const SIZE = {
  sm: 'size-7 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-12 text-base',
}

const SPINNER_SIZE = {
  sm: 'size-3',
  md: 'size-3.5',
  lg: 'size-4',
}

interface ProfileAvatarProps {
  userId: string
  name: string | null
  email: string | null
  avatarUrl?: string | null
  /**
   * tooltip: shows only the avatar circle; name appears on hover in a Tooltip.
   * inline: renders the avatar with the name displayed to its right.
   */
  variant?: 'tooltip' | 'inline'
  size?: 'sm' | 'md' | 'lg'
  /** When true, links to /profile (current user). Otherwise links to /users/:userId. */
  isSelf?: boolean
  /** When true, renders as a non-interactive display element (no link). */
  noLink?: boolean
  /** When true, shows a loading spinner instead of the avatar content. */
  isLoading?: boolean
  className?: string
}

export function AvatarCircle({
  userId,
  name,
  email,
  avatarUrl,
  size = 'md',
  isLoading = false,
}: Pick<ProfileAvatarProps, 'userId' | 'name' | 'email' | 'avatarUrl' | 'size' | 'isLoading'>) {
  const sizeClass = SIZE[size]
  const bg = colorFor(userId)
  const ini = initials(name, email, userId)

  if (isLoading) {
    return (
      <span
        className={cn(
          'shrink-0 inline-flex items-center justify-center rounded-full bg-muted ring-1 ring-border',
          sizeClass,
        )}
      >
        <Spinner className={SPINNER_SIZE[size]} />
      </span>
    )
  }

  if (avatarUrl) {
    return (
      <span
        className={cn(
          'shrink-0 overflow-hidden rounded-full ring-1 ring-border',
          sizeClass,
          'inline-flex items-center justify-center',
        )}
      >
        <img src={avatarUrl} alt="" className="size-full object-cover" />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center justify-center rounded-full font-semibold text-white',
        sizeClass,
        bg,
      )}
    >
      {ini}
    </span>
  )
}

export default function ProfileAvatar({
  userId,
  name,
  email,
  avatarUrl,
  variant = 'tooltip',
  size = 'md',
  isSelf = false,
  noLink = false,
  isLoading = false,
  className,
}: ProfileAvatarProps) {
  const to = isSelf ? '/profile' : userProfilePath(userId)
  const displayName = name || email || 'Unknown user'

  const circle = (
    <AvatarCircle userId={userId} name={name} email={email} avatarUrl={avatarUrl} size={size} isLoading={isLoading} />
  )

  if (variant === 'inline') {
    const nameEl = isLoading ? null : (
      <span className="min-w-0 truncate text-sm font-medium">{displayName}</span>
    )
    if (noLink) {
      return (
        <span className={cn('inline-flex w-fit min-w-0 items-center gap-2', className)}>
          {circle}
          {nameEl}
        </span>
      )
    }
    return (
      <Link
        to={to}
        className={cn('inline-flex w-fit min-w-0 items-center gap-2 hover:opacity-80 transition-opacity', className)}
      >
        {circle}
        {nameEl}
      </Link>
    )
  }

  // tooltip variant
  if (noLink) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex w-fit', className)}>{circle}</span>
        </TooltipTrigger>
        <TooltipContent>{isLoading ? 'Loading…' : displayName}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to={to} className={cn('inline-flex w-fit hover:opacity-80 transition-opacity', className)}>
          {circle}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{isLoading ? 'Loading…' : displayName}</TooltipContent>
    </Tooltip>
  )
}
