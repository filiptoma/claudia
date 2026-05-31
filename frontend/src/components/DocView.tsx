import Markdown from './Markdown'
import { useSignedImages } from '../hooks/useTree'

export default function DocView({ content }: { content: string }) {
  const images = useSignedImages(content)
  if (!content.trim()) {
    return <p className="doc-empty">This document is empty.</p>
  }
  return <Markdown images={images}>{content}</Markdown>
}
