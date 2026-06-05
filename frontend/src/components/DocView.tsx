import Markdown from './Markdown'
import { useSignedImages } from '../hooks/useTree'

export default function DocView({ content, annotate = false }: { content: string; annotate?: boolean }) {
  const images = useSignedImages(content)
  if (!content.trim()) {
    return <p className="text-muted-foreground italic">This document is empty.</p>
  }
  return (
    <Markdown images={images} annotate={annotate}>
      {content}
    </Markdown>
  )
}
