import { formatDateTime } from '../../lib/labels'

// Compact relative time ("just now", "5m", "3h", "2d"), falling back to an absolute date past a week.
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const secs = Math.round((Date.now() - then) / 1000)
  if (!Number.isFinite(secs)) return ''
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d`
  return formatDateTime(iso)
}

// The message shape both comment and suggestion replies share (structurally assignable).
export interface DisplayMessage {
  id: string
  author: string | null
  author_name: string | null
  author_avatar_url: string | null
  body: string
  created_at: string
}
