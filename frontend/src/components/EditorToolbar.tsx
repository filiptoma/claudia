import {
  Bold,
  Italic,
  Strikethrough,
  Heading,
  Link as LinkIcon,
  Code,
  SquareCode,
  List,
  ListOrdered,
  Quote,
  Image as ImageIcon,
  Table,
  Minus,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Ban,
} from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import type { ChangeSpec } from '@codemirror/state'
import {
  tableAddColLeft,
  tableAddColRight,
  tableAddRow,
  tableMoveColLeft,
  tableMoveColRight,
  tableMoveRowDown,
  tableMoveRowUp,
  tableRemoveRow,
  tableSetAlign,
} from '../lib/mdTable'

type Cmd = (view: EditorView) => void

const wrap =
  (before: string, after = before): Cmd =>
  (view) => {
    view.focus()
    view.dispatch(
      view.state.changeByRange((range) => ({
        changes: [
          { from: range.from, insert: before },
          { from: range.to, insert: after },
        ],
        range: EditorSelection.range(range.from + before.length, range.to + before.length),
      })),
    )
  }

const prefixLines =
  (make: (i: number) => string): Cmd =>
  (view) => {
    view.focus()
    const { state } = view
    const fromLine = state.doc.lineAt(state.selection.main.from).number
    const toLine = state.doc.lineAt(state.selection.main.to).number
    const changes: ChangeSpec[] = []
    let i = 0
    for (let ln = fromLine; ln <= toLine; ln++) {
      const line = state.doc.line(ln)
      changes.push({ from: line.from, insert: make(i++) })
    }
    view.dispatch({ changes })
  }

const insertLink: Cmd = (view) => {
  view.focus()
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to) || 'text'
      const insert = `[${text}](url)`
      const urlFrom = range.from + text.length + 3
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(urlFrom, urlFrom + 3),
      }
    }),
  )
}

const insertCodeBlock: Cmd = (view) => {
  view.focus()
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to) || 'code'
      const insert = '```\n' + text + '\n```'
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + 4, range.from + 4 + text.length),
      }
    }),
  )
}

// Insert a block on its own line(s).
const insertBlock =
  (body: string): Cmd =>
  (view) => {
    view.focus()
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    const before = head === line.from ? '' : '\n'
    const text = `${before}${body}\n`
    view.dispatch({
      changes: { from: head, insert: text },
      selection: EditorSelection.cursor(head + text.length),
    })
  }

const TABLE_TEMPLATE =
  '| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Text     | Text     | Text     |'

const BASE_BUTTONS: { title: string; Icon: typeof Bold; cmd: Cmd }[] = [
  { title: 'Bold', Icon: Bold, cmd: wrap('**') },
  { title: 'Italic', Icon: Italic, cmd: wrap('*') },
  { title: 'Strikethrough', Icon: Strikethrough, cmd: wrap('~~') },
  { title: 'Heading', Icon: Heading, cmd: prefixLines(() => '## ') },
  { title: 'Link', Icon: LinkIcon, cmd: insertLink },
  { title: 'Inline code', Icon: Code, cmd: wrap('`') },
  { title: 'Code block', Icon: SquareCode, cmd: insertCodeBlock },
  { title: 'Bullet list', Icon: List, cmd: prefixLines(() => '- ') },
  { title: 'Numbered list', Icon: ListOrdered, cmd: prefixLines((i) => `${i + 1}. `) },
  { title: 'Quote', Icon: Quote, cmd: prefixLines(() => '> ') },
]

const INSERT_BUTTONS: { title: string; Icon: typeof Bold; cmd: Cmd }[] = [
  { title: 'Insert table', Icon: Table, cmd: insertBlock(TABLE_TEMPLATE) },
  { title: 'Horizontal line', Icon: Minus, cmd: insertBlock('---') },
]

const TABLE_BUTTONS: { title: string; Icon: typeof Bold; cmd: Cmd }[] = [
  { title: 'Insert row below', Icon: BetweenHorizontalEnd, cmd: tableAddRow },
  { title: 'Delete row', Icon: Trash2, cmd: tableRemoveRow },
  { title: 'Move row up', Icon: ArrowUp, cmd: tableMoveRowUp },
  { title: 'Move row down', Icon: ArrowDown, cmd: tableMoveRowDown },
  { title: 'Add column right', Icon: BetweenVerticalEnd, cmd: tableAddColRight },
  { title: 'Insert column left', Icon: BetweenVerticalStart, cmd: tableAddColLeft },
  { title: 'Move column left', Icon: ArrowLeft, cmd: tableMoveColLeft },
  { title: 'Move column right', Icon: ArrowRight, cmd: tableMoveColRight },
  { title: 'Align left', Icon: AlignLeft, cmd: tableSetAlign('left') },
  { title: 'Align center', Icon: AlignCenter, cmd: tableSetAlign('center') },
  { title: 'Align right', Icon: AlignRight, cmd: tableSetAlign('right') },
  { title: 'Align none', Icon: Ban, cmd: tableSetAlign('none') },
]

export default function EditorToolbar({
  getView,
  onImageClick,
  inTable,
}: {
  getView: () => EditorView | null
  onImageClick: () => void
  inTable: boolean
}) {
  const run = (cmd: Cmd) => () => {
    const view = getView()
    if (view) cmd(view)
  }
  return (
    <div className="toolbar">
      {BASE_BUTTONS.map(({ title, Icon, cmd }) => (
        <button key={title} className="icon-btn" title={title} aria-label={title} onClick={run(cmd)}>
          <Icon size={16} />
        </button>
      ))}
      <span className="toolbar-sep" />
      {INSERT_BUTTONS.map(({ title, Icon, cmd }) => (
        <button key={title} className="icon-btn" title={title} aria-label={title} onClick={run(cmd)}>
          <Icon size={16} />
        </button>
      ))}
      <button className="icon-btn" title="Insert image" aria-label="Insert image" onClick={onImageClick}>
        <ImageIcon size={16} />
      </button>
      {inTable && (
        <>
          <span className="toolbar-sep" />
          {TABLE_BUTTONS.map(({ title, Icon, cmd }) => (
            <button key={title} className="icon-btn" title={title} aria-label={title} onClick={run(cmd)}>
              <Icon size={16} />
            </button>
          ))}
        </>
      )}
    </div>
  )
}
