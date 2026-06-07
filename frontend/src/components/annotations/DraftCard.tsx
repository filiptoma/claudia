import Composer from './Composer'
import SuggestionComposer from './SuggestionComposer'

// The in-progress composer for a brand-new comment or suggestion, anchored to the just-made
// selection. Flat by design — the floating window / focus sheet supplies the title + close button.
export default function DraftCard({
  kind,
  originalMd,
  projectId,
  busy,
  onSubmitComment,
  onSubmitSuggestion,
  onCancel,
}: {
  kind: 'comment' | 'suggestion'
  originalMd: string
  projectId: string
  busy: boolean
  onSubmitComment: (body: string, mentions: string[]) => void
  onSubmitSuggestion: (suggestedMd: string, note: string, mentions: string[]) => void
  onCancel: () => void
}) {
  if (kind === 'comment') {
    return (
      <Composer
        projectId={projectId}
        autoFocus
        submitLabel="Comment"
        busy={busy}
        onSubmit={onSubmitComment}
        onCancel={onCancel}
      />
    )
  }

  return (
    <SuggestionComposer
      projectId={projectId}
      originalMd={originalMd}
      editable
      busy={busy}
      onSubmit={onSubmitSuggestion}
      onCancel={onCancel}
    />
  )
}
