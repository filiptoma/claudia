import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'full' | 'medium' | 'markdown'

const MAX_W: Record<Variant, string> = {
  full: 'max-w-7xl',
  medium: 'max-w-3xl',
  markdown: 'max-w-2xl',
}

export default function PageLayout({
  children,
  className,
  variant = 'full',
}: {
  children: ReactNode
  className?: string
  variant?: Variant
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-8 pb-24 max-md:px-4 max-md:pb-16',
        variant === 'full' ? 'pt-6 max-md:pt-5' : 'pt-8 max-md:pt-6',
        MAX_W[variant],
        className,
      )}
    >
      {children}
    </div>
  )
}
