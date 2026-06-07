import type { ReactNode } from 'react'
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
  AtSign,
  Table,
  Minus,
  Plus,
  RotateCcw,
  ArrowUpFromLine,
  ArrowDownFromLine,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  SquareMinus,
  SquarePlus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Ban,
  Sigma,
} from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import type { ChangeSpec } from '@codemirror/state'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  tableAddColRight,
  tableAddRow,
  tableMoveColLeft,
  tableMoveColRight,
  tableMoveRowDown,
  tableMoveRowUp,
  tableRemoveCol,
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
    let emptyCursor: number | null = null
    for (let ln = fromLine; ln <= toLine; ln++) {
      const line = state.doc.line(ln)
      const prefix = make(i++)
      changes.push({ from: line.from, insert: prefix })
      // On a single empty line, drop the caret right after the marker so you can type immediately.
      if (fromLine === toLine && line.length === 0) emptyCursor = line.from + prefix.length
    }
    view.dispatch({
      changes,
      ...(emptyCursor !== null ? { selection: EditorSelection.cursor(emptyCursor) } : {}),
    })
  }

// Heading button: cycle the current line(s) through H1 → H2 → H3 → H1, replacing the marker rather
// than stacking more "#". A line with no heading becomes H1.
const cycleHeading: Cmd = (view) => {
  view.focus()
  const { state } = view
  const fromLine = state.doc.lineAt(state.selection.main.from).number
  const toLine = state.doc.lineAt(state.selection.main.to).number
  const changes: ChangeSpec[] = []
  let emptyCursor: number | null = null
  for (let ln = fromLine; ln <= toLine; ln++) {
    const line = state.doc.line(ln)
    const m = /^(#{1,6})\s+/.exec(line.text)
    const level = m ? m[1].length : 0
    const next = level >= 3 ? 1 : level + 1
    const prefix = '#'.repeat(next) + ' '
    const oldLen = m ? m[0].length : 0
    changes.push({ from: line.from, to: line.from + oldLen, insert: prefix })
    // Empty heading line (only the marker, no text): caret after the marker.
    if (fromLine === toLine && line.text.length === oldLen) emptyCursor = line.from + prefix.length
  }
  view.dispatch({
    changes,
    ...(emptyCursor !== null ? { selection: EditorSelection.cursor(emptyCursor) } : {}),
  })
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

const insertMath: Cmd = (view) => {
  view.focus()
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to)
      if (text) {
        const insert = `$${text}$`
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.range(range.from + 1, range.from + 1 + text.length),
        }
      }
      const insert = '$$\n\n$$'
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + 3),
      }
    }),
  )
}

const TABLE_TEMPLATE =
  '| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Text     | Text     | Text     |'

type ButtonDef = { title: string; Icon: typeof Bold; cmd: Cmd }

const BASE_BUTTONS: ButtonDef[] = [
  { title: 'Bold', Icon: Bold, cmd: wrap('**') },
  { title: 'Italic', Icon: Italic, cmd: wrap('*') },
  { title: 'Strikethrough', Icon: Strikethrough, cmd: wrap('~~') },
  { title: 'Heading', Icon: Heading, cmd: cycleHeading },
  { title: 'Link', Icon: LinkIcon, cmd: insertLink },
  { title: 'Inline code', Icon: Code, cmd: wrap('`') },
  { title: 'Code block', Icon: SquareCode, cmd: insertCodeBlock },
  { title: 'Bullet list', Icon: List, cmd: prefixLines(() => '- ') },
  { title: 'Numbered list', Icon: ListOrdered, cmd: prefixLines((i) => `${i + 1}. `) },
  { title: 'Quote', Icon: Quote, cmd: prefixLines(() => '> ') },
  { title: 'Math', Icon: Sigma, cmd: insertMath },
]

const INSERT_BUTTONS: ButtonDef[] = [
  { title: 'Horizontal line', Icon: Minus, cmd: insertBlock('---') },
]

// Table controls, grouped for the second toolbar row (shown only when the cursor is in a table).
const ROW_BUTTONS: ButtonDef[] = [
  { title: 'Add row below', Icon: SquarePlus, cmd: tableAddRow },
  { title: 'Delete row', Icon: SquareMinus, cmd: tableRemoveRow },
  { title: 'Move row up', Icon: ArrowUpFromLine, cmd: tableMoveRowUp },
  { title: 'Move row down', Icon: ArrowDownFromLine, cmd: tableMoveRowDown },
]
const COLUMN_BUTTONS: ButtonDef[] = [
  { title: 'Add column right', Icon: SquarePlus, cmd: tableAddColRight },
  { title: 'Delete column', Icon: SquareMinus, cmd: tableRemoveCol },
  { title: 'Move column left', Icon: ArrowLeftFromLine, cmd: tableMoveColLeft },
  { title: 'Move column right', Icon: ArrowRightFromLine, cmd: tableMoveColRight },
]
const ALIGN_BUTTONS: ButtonDef[] = [
  { title: 'Align left', Icon: AlignLeft, cmd: tableSetAlign('left') },
  { title: 'Align center', Icon: AlignCenter, cmd: tableSetAlign('center') },
  { title: 'Align right', Icon: AlignRight, cmd: tableSetAlign('right') },
  { title: 'Align none', Icon: Ban, cmd: tableSetAlign('none') },
]

function ToolButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground max-md:size-10 max-md:[&_svg]:size-5"
          aria-label={title}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

const ToolSep = () => <Separator orientation="vertical" className="mx-1 h-5!" />

// A labelled cluster of table buttons (Row / Column / Alignment) for the second toolbar row.
function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="px-1 text-[0.62rem] leading-none font-semibold tracking-wide text-muted-foreground/70 uppercase">
        {label}
      </span>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  )
}

function ButtonRow({ buttons, run }: { buttons: ButtonDef[]; run: (cmd: Cmd) => () => void }) {
  return (
    <>
      {buttons.map(({ title, Icon, cmd }) => (
        <ToolButton key={title} title={title} onClick={run(cmd)}>
          <Icon />
        </ToolButton>
      ))}
    </>
  )
}

// When the cursor sits inside an image, the toolbar collapses to just image-size controls: shrink /
// grow (aspect ratio preserved — only the width changes) plus a reset, with the current width shown.
function ImageControls({
  width,
  onWider,
  onNarrower,
  onReset,
}: {
  width: number | null
  onWider: () => void
  onNarrower: () => void
  onReset: () => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      <span className="mr-1 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        <ImageIcon className="size-4" /> Image
      </span>
      <ToolButton title="Smaller" onClick={onNarrower}>
        <Minus />
      </ToolButton>
      <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
        {width ? `${width}px` : 'auto'}
      </span>
      <ToolButton title="Larger" onClick={onWider}>
        <Plus />
      </ToolButton>
      <ToolSep />
      <ToolButton title="Reset size" onClick={onReset}>
        <RotateCcw />
      </ToolButton>
    </div>
  )
}

export default function EditorToolbar({
  getView,
  onImageClick,
  onRefClick,
  inTable,
  inImage,
  imageWidth,
  onImageWider,
  onImageNarrower,
  onImageResetSize,
}: {
  getView: () => EditorView | null
  onImageClick: () => void
  onRefClick: () => void
  inTable: boolean
  inImage: boolean
  imageWidth: number | null
  onImageWider: () => void
  onImageNarrower: () => void
  onImageResetSize: () => void
}) {
  const run = (cmd: Cmd) => () => {
    const view = getView()
    if (view) cmd(view)
  }

  // Image context: show only the image-size controls.
  if (inImage) {
    return (
      <ImageControls
        width={imageWidth}
        onWider={onImageWider}
        onNarrower={onImageNarrower}
        onReset={onImageResetSize}
      />
    )
  }

  // Individual buttons are the direct children of the wrapping row, so each icon wraps to the next line
  // on its own when the pane is narrow (rather than a whole cluster overflowing). The labelled table
  // groups below stay grouped (they wrap as units) since their label must travel with their buttons.
  return (
    <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
      {/* Core formatting actions */}
      <ButtonRow buttons={BASE_BUTTONS} run={run} />

      <ToolSep />

      {/* Support / insert actions */}
      {/* Insert table — shown unless the cursor is already inside a table (then table controls show). */}
      {!inTable && (
        <ToolButton title="Insert table" onClick={run(insertBlock(TABLE_TEMPLATE))}>
          <Table />
        </ToolButton>
      )}
      <ButtonRow buttons={INSERT_BUTTONS} run={run} />
      <ToolButton title="Insert image" onClick={onImageClick}>
        <ImageIcon />
      </ToolButton>
      <ToolButton title="Insert reference (type / in the editor)" onClick={onRefClick}>
        <AtSign />
      </ToolButton>

      {/* Table controls (Row / Column / Alignment) — each its own cluster, only while in a table. */}
      {inTable && (
        <>
          <ToolSep />
          <ToolGroup label="Row">
            <ButtonRow buttons={ROW_BUTTONS} run={run} />
          </ToolGroup>
          <ToolSep />
          <ToolGroup label="Column">
            <ButtonRow buttons={COLUMN_BUTTONS} run={run} />
          </ToolGroup>
          <ToolSep />
          <ToolGroup label="Alignment">
            <ButtonRow buttons={ALIGN_BUTTONS} run={run} />
          </ToolGroup>
        </>
      )}
    </div>
  )
}
