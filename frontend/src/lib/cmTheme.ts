import { EditorView } from '@codemirror/view'

// Shared CodeMirror chrome for the source editors (markdown + LaTeX). Font (mono), size and line
// height are matched to the rendered markdown (.md) so source and preview lines sit at the same y in
// split mode. Extracted from Editor.tsx so the LaTeX editor renders identical chrome.
export const cmChrome = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.95rem',
    lineHeight: '1.7',
  },
  '.cm-content': { padding: '1rem' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
})

// materialLight is washed-out (light gray text on near-white); darken the body text + caret so the
// light-mode editor is comfortably readable. Layered on top of materialLight (light mode only).
export const cmLightContrast = EditorView.theme(
  {
    '.cm-content': { color: '#1f2937' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#1f2937' },
  },
  { dark: false },
)
