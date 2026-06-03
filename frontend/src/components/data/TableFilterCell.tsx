import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { ColumnFilterConfig, FilterValue, RangeValue } from './types'

// "Any" needs a non-empty sentinel because radix Select forbids an empty-string item value.
const ANY_VALUE = '__any__'

const INPUT_CLASS = 'h-8 text-xs'

type FilterCellProps = {
  config: ColumnFilterConfig
  value: FilterValue
  onChange: (value: FilterValue) => void
}

/** A debounced text/number input that only bubbles its value up after the user stops typing. */
function DebouncedInput({
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'number'
  placeholder?: string
}) {
  const [local, setLocal] = useState(value)
  // Keep local state in sync when the value is reset/changed from outside (e.g. cleared filters),
  // adjusting during render rather than in an effect (no cascading re-render).
  const [tracked, setTracked] = useState(value)
  if (tracked !== value) {
    setTracked(value)
    setLocal(value)
  }

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <Input
      type={type}
      value={local}
      placeholder={placeholder ?? 'Filter…'}
      className={INPUT_CLASS}
      onChange={(e) => {
        const next = e.target.value
        setLocal(next)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => onChange(next), 300)
      }}
    />
  )
}

export default function TableFilterCell({ config, value, onChange }: FilterCellProps) {
  switch (config.type) {
    case 'text':
      return (
        <DebouncedInput
          value={typeof value === 'string' ? value : ''}
          placeholder={config.placeholder}
          onChange={(v) => onChange(v === '' ? undefined : v)}
        />
      )

    case 'number':
      return (
        <DebouncedInput
          type="number"
          value={value == null ? '' : String(value)}
          placeholder={config.placeholder}
          onChange={(v) => onChange(v === '' ? undefined : Number(v))}
        />
      )

    case 'select': {
      const current = typeof value === 'string' && value !== '' ? value : ANY_VALUE
      return (
        <Select
          value={current}
          onValueChange={(v) => onChange(v === ANY_VALUE ? undefined : v)}
        >
          <SelectTrigger size="sm" className="h-8 w-full text-xs">
            <SelectValue placeholder={config.placeholder ?? 'Any'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_VALUE}>Any</SelectItem>
            {config.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    case 'multiselect': {
      const selected = Array.isArray(value) ? value : []
      const toggle = (optValue: string) => {
        const next = selected.includes(optValue)
          ? selected.filter((v) => v !== optValue)
          : [...selected, optValue]
        onChange(next.length === 0 ? undefined : next)
      }
      return (
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 justify-between gap-1.5 text-xs">
                <span>{config.placeholder ?? 'Any'}</span>
                {selected.length > 0 && (
                  <Badge variant="secondary" className="px-1.5">
                    {selected.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {config.options?.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={selected.includes(opt.value)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggle(opt.value)}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {selected.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Clear filter"
              onClick={() => onChange(undefined)}
            >
              <X />
            </Button>
          )}
        </div>
      )
    }

    case 'date':
      return (
        <Input
          type="date"
          value={typeof value === 'string' ? value : ''}
          className={INPUT_CLASS}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      )

    case 'datetime':
      return (
        <Input
          type="datetime-local"
          value={typeof value === 'string' ? value : ''}
          className={INPUT_CLASS}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      )

    case 'dateRange':
    case 'datetimeRange': {
      const range = (value ?? {}) as RangeValue
      const inputType = config.type === 'dateRange' ? 'date' : 'datetime-local'
      const update = (next: RangeValue) => {
        const cleaned: RangeValue = {}
        if (next.from) cleaned.from = next.from
        if (next.to) cleaned.to = next.to
        onChange(cleaned.from || cleaned.to ? cleaned : undefined)
      }
      return (
        <div className="flex items-center gap-1">
          <Input
            type={inputType}
            value={range.from ?? ''}
            aria-label="From"
            className={INPUT_CLASS}
            onChange={(e) => update({ ...range, from: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type={inputType}
            value={range.to ?? ''}
            aria-label="To"
            className={INPUT_CLASS}
            onChange={(e) => update({ ...range, to: e.target.value })}
          />
        </div>
      )
    }

    default:
      return null
  }
}
