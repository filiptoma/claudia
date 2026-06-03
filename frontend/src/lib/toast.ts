import { toast as sonner } from 'sonner'
import type { ReactNode } from 'react'

export type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'message'

/**
 * App-wide notification helper. Usage:
 *   toast('success', 'Project created')
 *   toast('error', err.message)
 *   toast('info', <span>…JSX…</span>)
 */
export function toast(kind: ToastKind, content: ReactNode) {
  switch (kind) {
    case 'success':
      return sonner.success(content)
    case 'error':
      return sonner.error(content)
    case 'info':
      return sonner.info(content)
    case 'warning':
      return sonner.warning(content)
    default:
      return sonner.message(content)
  }
}
