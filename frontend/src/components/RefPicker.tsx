import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { FileText, Hash, CornerDownLeft } from 'lucide-react'
import { useTree } from '../hooks/useTree'
import { parseHeadings } from '../lib/headings'
import { docPathFromTree } from '../lib/paths'
import { cn } from '@/lib/utils'

export interface RefAnchor {
  left: number
  top: number
  bottom: number
}

interface Item {
  key: string
  label: string
  sub?: string
  depth?: number
  icon: 'doc' | 'heading'
  run: () => void
}

type Stage = 'kind' | 'document' | 'heading'

// Stages 2–3 of the slash flow, opened after the "Reference" command is chosen (the `/command` text
// has already been removed from the document). A focused popover: first choose Document or Heading,
// then pick the target (filter by typing). Confirming calls onPick; the editor inserts `[text](href)`
// at the trigger position with the text pre-selected. Escape steps back a stage, then closes.
export default function RefPicker({
  anchor,
  projectId,
  content,
  onPick,
  onClose,
}: {
  anchor: RefAnchor
  projectId: string
  content: string
  onPick: (r: { text: string; href: string }) => void
  onClose: () => void
}) {
  const { projects, folders, documents } = useTree()
  const [stage, setStage] = useState<Stage>('kind')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const project = projects.find((p) => p.id === projectId)
  const headings = useMemo(() => parseHeadings(content), [content])
  const projectDocs = useMemo(
    () =>
      documents
        .filter((d) => d.project_id === projectId && !d.is_quick_note)
        .map((d) => {
          const folder = d.folder_id ? folders.find((f) => f.id === d.folder_id) : undefined
          return {
            id: d.id,
            title: d.title || 'Untitled',
            sub: folder ? folder.name : 'Root',
            href: project ? docPathFromTree(project.slug, d, folders) : '#',
          }
        })
        .sort((a, b) => a.title.localeCompare(b.title)),
    [documents, folders, projectId, project],
  )

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()
    const has = (s: string) => s.toLowerCase().includes(q)
    const go = (next: Stage) => {
      setStage(next)
      setQuery('')
      setActive(0)
    }
    if (stage === 'kind') {
      const kinds: Item[] = [
        { key: 'document', label: 'Document', sub: 'Link to another document', icon: 'doc', run: () => go('document') },
        { key: 'heading', label: 'Heading', sub: 'Jump to a heading in this document', icon: 'heading', run: () => go('heading') },
      ]
      return q ? kinds.filter((k) => has(k.label)) : kinds
    }
    if (stage === 'document') {
      return projectDocs
        .filter((d) => !q || has(d.title) || has(d.sub))
        .map((d) => ({ key: d.id, label: d.title, sub: d.sub, icon: 'doc', run: () => onPick({ text: d.title, href: d.href }) }))
    }
    return headings
      .filter((h) => !q || has(h.text))
      .map((h, i) => ({
        key: `${h.slug}-${i}`,
        label: h.text,
        sub: `#${h.slug}`,
        depth: h.depth,
        icon: 'heading',
        run: () => onPick({ text: h.text, href: `#${h.slug}` }),
      }))
  }, [stage, query, projectDocs, headings, onPick])

  const back = () => {
    setQuery('')
    setActive(0)
    if (stage === 'kind') onClose()
    else setStage('kind')
  }

  const safeActive = items.length ? Math.min(active, items.length - 1) : 0
  useEffect(() => inputRef.current?.focus(), [stage])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${safeActive}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [safeActive])
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(Math.min(safeActive + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(safeActive - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      items[safeActive]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      back()
    } else if (e.key === 'Backspace' && query === '') {
      e.preventDefault()
      back()
    }
  }

  const below = anchor.bottom + 320 < window.innerHeight
  const style: CSSProperties = below
    ? { left: anchor.left, top: anchor.bottom + 6 }
    : { left: anchor.left, bottom: window.innerHeight - anchor.top + 6 }
  const placeholder =
    stage === 'kind' ? 'Document or heading…' : stage === 'document' ? 'Search documents…' : 'Search headings…'
  const crumb = stage === 'kind' ? 'Reference' : stage === 'document' ? 'Reference › Document' : 'Reference › Heading'

  return (
    <div
      ref={rootRef}
      className="fixed z-50 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      style={style}
    >
      <div className="border-b border-border px-2.5 pt-2 pb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
        {crumb}
      </div>
      <div className="p-1.5">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="mb-1 h-8 w-full rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div ref={listRef} className="max-h-64 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">No matches</div>
          ) : (
            items.map((it, i) => (
              <button
                key={it.key}
                data-idx={i}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => it.run()}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
                  i === safeActive ? 'bg-accent text-accent-foreground' : 'text-foreground',
                )}
              >
                {it.icon === 'heading' ? (
                  <Hash
                    className="size-4 shrink-0 text-muted-foreground"
                    style={it.depth ? { marginLeft: (it.depth - 1) * 8 } : undefined}
                  />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{it.label}</span>
                  {it.sub && <span className="truncate text-xs text-muted-foreground">{it.sub}</span>}
                </span>
                {i === safeActive && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
