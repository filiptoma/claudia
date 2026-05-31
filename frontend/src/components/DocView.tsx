import Markdown from './Markdown'

export default function DocView({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="doc-empty">This document is empty.</p>
  }
  return <Markdown>{content}</Markdown>
}
