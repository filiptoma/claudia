import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePresence } from '../hooks/usePresence'
import { AvatarCircle } from './ProfileAvatar'

// Max avatars rendered before collapsing the rest into a "+N" chip.
const MAX_SHOWN = 4

/**
 * Overlapping avatar stack of the OTHER users currently viewing this document (self is excluded — your
 * own presence is already implied by the header profile menu). Renders nothing when you're alone, so a
 * solo reader sees no chrome. Subscribes via usePresence → the private `doc:<id>` channel (RLS-gated).
 */
export default function PresenceAvatars({ docId, projectId }: { docId: string; projectId: string }) {
  const { users } = usePresence(docId, projectId)
  const others = users.filter((u) => !u.isSelf)
  if (others.length === 0) return null

  const shown = others.slice(0, MAX_SHOWN)
  const overflow = others.length - shown.length

  return (
    <div className="flex items-center pr-0.5" aria-label={`${others.length} other ${others.length === 1 ? 'person' : 'people'} viewing`}>
      <div className="flex -space-x-2">
        {shown.map((u) => (
          <Tooltip key={u.uid}>
            <TooltipTrigger asChild>
              <span className="inline-flex rounded-full ring-2 ring-background">
                <AvatarCircle
                  userId={u.uid}
                  name={u.name}
                  email={u.email}
                  avatarUrl={u.avatarUrl}
                  size="sm"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>{(u.name || u.email || 'Someone') + ' is viewing'}</TooltipContent>
          </Tooltip>
        ))}
        {overflow > 0 && (
          <span
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-full bg-muted text-[0.7rem] font-semibold text-muted-foreground ring-2 ring-background',
            )}
          >
            +{overflow}
          </span>
        )}
      </div>
    </div>
  )
}
