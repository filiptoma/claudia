import { cn } from '@/lib/utils'

/**
 * Standard page title + optional subtitle used at the top of content pages.
 * Smaller text and tighter spacing on mobile automatically.
 */
export default function PageHeader({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn('mb-6 max-md:mb-4', className)}>
      <h1 className="text-2xl font-bold tracking-tight max-md:text-xl">{title}</h1>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
