import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useMentionableByEmail, useMentionableUsers } from '../../hooks/useAnnotations'
import { extractMentionIds, mentionToken } from './mention'
import MentionMenu from './MentionMenu'
import type { MentionableUser } from '../../lib/types'

// The `@query` immediately before the caret (no whitespace in it, and the `@` not glued to a word —
// so emails aren't mistaken for mentions). Returns the `@`'s offset + the query text, or null.
function activeMention(value: string, caret: number): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i]
    if (ch === '@') {
      const prev = i > 0 ? value[i - 1] : ' '
      if (i === 0 || /[\s([{>]/.test(prev)) {
        const query = value.slice(i + 1, caret)
        return /\s/.test(query) ? null : { start: i, query }
      }
      // A glued `@` (e.g. an email's `@`) isn't itself a mention trigger — keep scanning back, so
      // `@john@example.com` still resolves to the leading mention `@` with the whole email as query.
      continue
    }
    if (/\s/.test(ch)) return null
  }
  return null
}

/**
 * Textarea with @-mention typeahead, reused by comment & suggestion composers. Stores mentions
 * inline as `@[Name](mention:uuid)` tokens; `onSubmit` receives the body plus the resolved uuids.
 */
export default function Composer({
  projectId,
  placeholder,
  autoFocus = false,
  submitLabel = 'Comment',
  busy = false,
  initialValue = '',
  minRows = 2,
  allowEmpty = false,
  iconOnly = false,
  leading,
  submitIcon,
  onSubmit,
  onCancel,
}: {
  projectId: string
  placeholder?: string
  autoFocus?: boolean
  submitLabel?: string
  busy?: boolean
  initialValue?: string
  minRows?: number
  /** Allow submitting an empty body (e.g. a suggestion's optional note). */
  allowEmpty?: boolean
  /** Render the submit control as an icon-only button (the reply send affordance). */
  iconOnly?: boolean
  /** Node placed at the start of the action row (e.g. a card's "…" actions menu). */
  leading?: ReactNode
  /** Icon for the submit button (defaults to a send arrow; e.g. a check for an "Save" edit). */
  submitIcon?: ReactNode
  onSubmit: (body: string, mentions: string[]) => void
  onCancel?: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [caret, setCaret] = useState(initialValue.length)
  const [active, setActive] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // The textarea element in state too (so the mention menu can anchor to it without reading a ref
  // during render). A stable callback ref keeps both in sync.
  const [taEl, setTaEl] = useState<HTMLTextAreaElement | null>(null)
  const setTa = useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el
    setTaEl(el)
  }, [])
  const pendingCaret = useRef<number | null>(null)

  const allUsers = useMentionableUsers(projectId)
  const mention = menuOpen ? activeMention(value, caret) : null
  // When the query is a full email, resolve it to a (possibly non-member) mention target.
  const emailMatch = useMentionableByEmail(projectId, mention?.query ?? '')
  const candidates = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    const base = allUsers
      .filter((u) => !q || (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q))
      .slice(0, 8)
    if (emailMatch && !base.some((u) => u.id === emailMatch.id)) return [emailMatch, ...base].slice(0, 8)
    return base
  }, [mention, allUsers, emailMatch])

  const showMenu = menuOpen && !!mention && candidates.length > 0
  const safeActive = candidates.length ? Math.min(active, candidates.length - 1) : 0

  // Apply a queued caret position after a programmatic value change (mention insertion).
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && taRef.current) {
      taRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  }, [value])

  const sync = (el: HTMLTextAreaElement) => {
    setValue(el.value)
    setCaret(el.selectionStart ?? el.value.length)
    setMenuOpen(true)
    setActive(0)
  }

  const pick = (user: MentionableUser) => {
    const m = activeMention(value, caret)
    if (!m) return
    const token = mentionToken(user.name || user.email || 'user', user.id)
    const before = value.slice(0, m.start)
    const after = value.slice(caret)
    const next = `${before}${token} ${after}`
    const nextCaret = (before + token + ' ').length
    pendingCaret.current = nextCaret
    setValue(next)
    setCaret(nextCaret)
    setMenuOpen(false)
    taRef.current?.focus()
  }

  const submit = () => {
    const body = value.trim()
    if ((!body && !allowEmpty) || busy) return
    onSubmit(body, extractMentionIds(body))
    setValue('')
    setCaret(0)
    setMenuOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => Math.min(a + 1, candidates.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => Math.max(a - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(candidates[safeActive])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenuOpen(false)
        return
      }
    }
    // Cmd/Ctrl+Enter submits; plain Enter inserts a newline.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={setTa}
        value={value}
        rows={minRows}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'Add a comment…  (@ to mention)'}
        onChange={(e) => sync(e.currentTarget)}
        onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-sm leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      />
      {showMenu && (
        <MentionMenu
          users={candidates}
          active={safeActive}
          anchorEl={taEl}
          onHover={setActive}
          onPick={pick}
        />
      )}
      <div className={cn('mt-1.5 flex items-center gap-2', leading ? 'justify-between' : 'justify-end')}>
        {leading}
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          {iconOnly ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 text-primary hover:text-primary"
              aria-label={submitLabel}
              onClick={submit}
              disabled={busy || (!allowEmpty && !value.trim())}
            >
              <SendHorizontal className="size-4" />
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={submit} disabled={busy || (!allowEmpty && !value.trim())}>
              {submitIcon ?? <SendHorizontal className="size-3.5" />}
              {submitLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
