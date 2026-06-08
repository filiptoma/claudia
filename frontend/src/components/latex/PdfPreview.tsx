import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

// The MVP PDF viewer: wrap the compiled bytes in a blob URL and feed them to a native <iframe>, which
// gives zoom / scroll / print / search / page-nav for free with zero deps and no Vite worker config.
// Because the LaTeX engine needs no cross-origin isolation (§0 decision 2), there's no COEP interaction
// to worry about here. (Upgrade path → a pdfjs canvas renderer only if we later need a custom toolbar,
// thumbnails, or SyncTeX — §3.7.)
//
// The URL is created and assigned imperatively in an effect, with the previous one revoked in the
// cleanup — so it's revoked on every bytes change AND on unmount, with no leaked URL from a discarded
// StrictMode double-render (which a useMemo-created URL would suffer). The `new Uint8Array(bytes)` copy
// gives an ArrayBuffer-backed view the strict BlobPart type accepts.
export default function PdfPreview({ bytes, className }: { bytes: Uint8Array | null; className?: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const el = iframeRef.current
    if (!el || !bytes) return
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }))
    el.src = url
    return () => URL.revokeObjectURL(url)
  }, [bytes])

  return <iframe ref={iframeRef} title="Compiled PDF" className={cn('h-full w-full border-0 bg-white', className)} />
}
