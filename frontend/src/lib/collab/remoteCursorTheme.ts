import { EditorView } from '@codemirror/view'

// Overrides y-codemirror.next's `yRemoteSelectionsTheme` for the remote co-editor caret + name label.
// That ships as a baseTheme, so this regular theme (higher precedence) wins where they overlap. We only
// touch two things:
//   1. A wider hover hit-area — the caret itself is a 1px bar, so revealing the name meant pixel-hunting.
//      A transparent ::before pads it out horizontally; pointer-events stay on, so hovering the pad still
//      counts as hovering the caret (`.cm-ySelectionCaret:hover > .cm-ySelectionInfo` reveals the label).
//   2. The label uses the app's UI font (var(--font-sans)) instead of the default serif, a touch larger.
export const remoteCursorTheme = EditorView.theme({
  '.cm-ySelectionCaret::before': {
    content: '""',
    position: 'absolute',
    top: '-0.15em',
    bottom: '-0.15em',
    left: '-0.5em',
    right: '-0.5em',
    // transparent: purely a hover target, no visual change to the caret
  },
  '.cm-ySelectionInfo': {
    fontFamily: 'var(--font-sans)',
    fontSize: '0.8rem',
    fontWeight: '500',
  },
})
