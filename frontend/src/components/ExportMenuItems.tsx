import { useState } from 'react'
import type { ReactNode } from 'react'
import { FileCode2, FileText, FileType, Loader2 } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/lib/toast'

type ExportKind = 'pdf' | 'html' | 'md'

/**
 * The "Export" section of a markdown document's actions menu (the app-bar ⋯). Renders a labelled group
 * of download items — vector PDF (Typst), a standalone HTML snapshot, or the raw markdown — meant to be
 * dropped inside an existing DropdownMenuContent (see ActionsMenu's `children`). The heavy ~27 MB
 * Typst/HTML pipeline in `lib/typst/export` is dynamically imported only when an action runs, so it
 * never enters the app-bar chunk.
 */
export default function ExportMenuItems({
  getContent,
  title,
  leadingSeparator = true,
}: {
  /** Reads the document's current markdown source (live editor content, falling back to saved). */
  getContent: () => string | null
  /** Document title — becomes the download filename and the PDF's metadata title. */
  title: string
  /** Divider above the section. Off when Export is the menu's only content (nothing to divide from). */
  leadingSeparator?: boolean
}) {
  const [busy, setBusy] = useState<ExportKind | null>(null)

  const run = async (kind: ExportKind) => {
    if (busy) return
    const content = getContent()
    if (content == null) {
      toast('error', 'Document is still loading')
      return
    }
    setBusy(kind)
    try {
      const x = await import('@/lib/typst/export')
      if (kind === 'md') {
        x.downloadFile(x.exportFilename(title, 'md'), content, 'text/markdown;charset=utf-8')
      } else if (kind === 'html') {
        const html = await x.renderStandaloneHtml(content, title)
        x.downloadFile(x.exportFilename(title, 'html'), html, 'text/html;charset=utf-8')
      } else {
        const pdf = await x.exportMarkdownToPdf(content, title)
        x.downloadFile(x.exportFilename(title, 'pdf'), pdf, 'application/pdf')
      }
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  const item = (kind: ExportKind, icon: ReactNode, label: string) => (
    <DropdownMenuItem
      disabled={!!busy}
      onSelect={(e) => {
        // Keep the menu open while the (possibly multi-second) export runs so its spinner stays visible.
        e.preventDefault()
        void run(kind)
      }}
    >
      {icon} {label}
      {busy === kind && <Loader2 className="ml-auto size-3.5 animate-spin" />}
    </DropdownMenuItem>
  )

  return (
    <>
      {leadingSeparator && <DropdownMenuSeparator />}
      <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Export</DropdownMenuLabel>
      {item('pdf', <FileType />, 'PDF')}
      {item('html', <FileCode2 />, 'HTML')}
      {item('md', <FileText />, 'Markdown')}
    </>
  )
}
