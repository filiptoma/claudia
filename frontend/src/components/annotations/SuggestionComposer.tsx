import { useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from '../../lib/toast'
import Composer from './Composer'
import DiffView from './DiffView'

/**
 * The shared body for proposing a suggested edit — used both by the view-mode draft (selecting text
 * then editing a replacement) and by the editor's suggestion-mode confirmation panel. Keeping it in
 * one place means both surfaces look and behave identically.
 *
 *  • editable: the replacement is typed here in a textarea (seeded from the original); a live diff
 *    preview appears once it differs.
 *  • non-editable: the replacement was already made elsewhere (the CodeMirror editor), so we just show
 *    the read-only diff of original → suggested.
 *
 * The optional note (with @-mentions) and the Cancel / Suggest buttons come from the inner Composer.
 */
export default function SuggestionComposer({
  projectId,
  originalMd,
  suggestedMd,
  editable = false,
  busy,
  submitLabel = 'Suggest',
  submitIcon,
  onSubmit,
  onCancel,
}: {
  projectId: string
  originalMd: string
  /** The pre-made replacement (non-editable mode). Ignored when `editable`. */
  suggestedMd?: string
  editable?: boolean
  busy: boolean
  submitLabel?: string
  submitIcon?: ReactNode
  onSubmit: (suggestedMd: string, note: string, mentions: string[]) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(suggestedMd ?? originalMd)
  const suggested = editable ? draft : suggestedMd ?? ''
  const changed = suggested !== originalMd

  return (
    <div className="flex flex-col gap-2">
      {editable ? (
        <>
          <label className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            Replacement
          </label>
          <textarea
            value={draft}
            autoFocus
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[0.8rem] leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
          {changed && (
            <div>
              <p className="mb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">Preview</p>
              <DiffView original={originalMd} suggested={draft} />
            </div>
          )}
        </>
      ) : (
        <DiffView original={originalMd} suggested={suggested} />
      )}

      <Composer
        projectId={projectId}
        submitLabel={submitLabel}
        submitIcon={submitIcon}
        placeholder="Add a note (optional)…  (@ to mention)"
        minRows={1}
        allowEmpty
        busy={busy}
        onCancel={onCancel}
        onSubmit={(note, mentions) => {
          if (!changed) {
            toast('error', 'Make a change to suggest an edit.')
            return
          }
          onSubmit(suggested, note, mentions)
        }}
      />
    </div>
  )
}
