import Markdown from './Markdown'
import { useSignedImages } from '../hooks/useTree'

export default function DocView({
  content,
  annotate = false,
  suggestions,
}: {
  content: string
  annotate?: boolean
  suggestions?: { id: string; sourceStart: number; sourceEnd: number; suggested: string }[]
}) {
  const images = useSignedImages(content)
  if (!content.trim()) {
    return <p className="text-muted-foreground italic">This document is empty.</p>
  }
  return (
    <Markdown images={images} annotate={annotate} suggestions={suggestions}>
      {content}
    </Markdown>
  )
}
