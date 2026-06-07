import { useMemo } from 'react'
import { parseBody } from './mention'

// Render a comment/suggestion body, turning @mention tokens into chips and preserving line breaks.
export default function MentionText({ body }: { body: string }) {
  const segments = useMemo(() => parseBody(body), [body])
  return (
    <span className="text-sm leading-relaxed whitespace-pre-wrap break-words">
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <span key={i} className="mention-chip">
            @{seg.name}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  )
}
