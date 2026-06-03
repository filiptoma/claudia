import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import type { PaginationState } from './types'

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50]

const range = (start: number, end: number): number[] => {
  const length = end - start + 1
  return Array.from({ length }, (_, i) => start + i)
}

/**
 * Build the list of page tokens to render: leading/trailing boundary pages, a window of `siblings`
 * around the current page, and `'dots'` sentinels where pages are skipped. No Mantine needed.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getPaginationRange(
  currentPage: number,
  totalPages: number,
  siblings = 1,
  boundaries = 1,
): (number | 'dots')[] {
  // If everything fits without gaps, just render every page.
  const totalPageNumbers = siblings * 2 + 3 + boundaries * 2
  if (totalPageNumbers >= totalPages) {
    return range(1, totalPages)
  }

  const leftSiblingIndex = Math.max(currentPage - siblings, boundaries + 1)
  const rightSiblingIndex = Math.min(currentPage + siblings, totalPages - boundaries)

  const shouldShowLeftDots = leftSiblingIndex > boundaries + 2
  const shouldShowRightDots = rightSiblingIndex < totalPages - (boundaries + 1)

  const result: (number | 'dots')[] = []

  result.push(...range(1, boundaries))

  if (shouldShowLeftDots) {
    result.push('dots')
  } else {
    result.push(...range(boundaries + 1, leftSiblingIndex - 1))
  }

  result.push(...range(leftSiblingIndex, rightSiblingIndex))

  if (shouldShowRightDots) {
    result.push('dots')
  } else {
    result.push(...range(rightSiblingIndex + 1, totalPages - boundaries))
  }

  result.push(...range(totalPages - boundaries + 1, totalPages))

  return result
}

type PaginationProps = {
  pagination: PaginationState
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  pageSizeOptions?: number[]
  siblings?: number
  boundaries?: number
}

export default function Pagination(props: PaginationProps) {
  const {
    pagination,
    onPageChange,
    onPageSizeChange,
    pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
    siblings = 1,
    boundaries = 1,
  } = props

  const { page, pageSize, total } = pagination
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const hasResults = total > 0
  const firstResult = hasResults ? (page - 1) * pageSize + 1 : 0
  const lastResult = hasResults ? Math.min(total, page * pageSize) : 0

  const pages = getPaginationRange(page, totalPages, siblings, boundaries)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v))}
        >
          <SelectTrigger size="sm" className="w-18">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>per page</span>
      </div>

      <p className="text-sm text-muted-foreground">
        {hasResults ? (
          <>
            Showing <span className="font-medium text-foreground">{firstResult}</span>–
            <span className="font-medium text-foreground">{lastResult}</span> of{' '}
            <span className="font-medium text-foreground">{total}</span>{' '}
            {total === 1 ? 'result' : 'results'}
          </>
        ) : (
          'No results'
        )}
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="First page"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
        >
          <ChevronsLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>

        {pages.map((item, index) =>
          item === 'dots' ? (
            <span
              key={`dots-${index}`}
              className="px-1 text-sm text-muted-foreground select-none"
              aria-hidden
            >
              …
            </span>
          ) : (
            <Button
              key={item}
              variant={item === page ? 'default' : 'ghost'}
              size="icon"
              className={cn('size-8', item === page && 'pointer-events-none')}
              aria-label={`Page ${item}`}
              aria-current={item === page ? 'page' : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ),
        )}

        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Last page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(totalPages)}
        >
          <ChevronsRight />
        </Button>
      </div>
    </div>
  )
}
