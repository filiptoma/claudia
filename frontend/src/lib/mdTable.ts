import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

// A small GFM-table engine for the editor toolbar: detect the table under the cursor, then
// add/remove/move rows & columns and set per-column alignment — HackMD-style.

export type Align = 'none' | 'left' | 'center' | 'right'

export interface TableModel {
  fromLine: number // 1-based line number of the header row
  toLine: number // 1-based line number of the last body row
  headers: string[]
  aligns: Align[]
  rows: string[][] // body rows, normalized to header column count
  cursorRow: number // 0 = header, 1..n = body row (1-based)
  cursorCol: number // 0-based column
}

const looksLikeRow = (line: string) => line.includes('|') && line.trim().length > 0
const isSeparator = (line: string) =>
  line.includes('|') && /^[\s|:-]+$/.test(line) && line.includes('-')

function splitCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

function parseAlign(cell: string): Align {
  const c = cell.trim()
  const l = c.startsWith(':')
  const r = c.endsWith(':')
  if (l && r) return 'center'
  if (r) return 'right'
  if (l) return 'left'
  return 'none'
}

/** Parse the markdown table the cursor is inside, or null if the cursor isn't in one. */
export function parseTableAt(view: EditorView): TableModel | null {
  const { state } = view
  const head = state.selection.main.head
  const curLine = state.doc.lineAt(head)
  if (!looksLikeRow(curLine.text)) return null

  let topNum = curLine.number
  while (topNum > 1 && looksLikeRow(state.doc.line(topNum - 1).text)) topNum--
  let botNum = curLine.number
  while (botNum < state.doc.lines && looksLikeRow(state.doc.line(botNum + 1).text)) botNum++

  if (botNum - topNum < 1) return null
  if (!isSeparator(state.doc.line(topNum + 1).text)) return null

  const headers = splitCells(state.doc.line(topNum).text)
  const ncols = headers.length
  const aligns = splitCells(state.doc.line(topNum + 1).text).map(parseAlign)
  while (aligns.length < ncols) aligns.push('none')

  const normalize = (r: string[]) => {
    const out = r.slice(0, ncols)
    while (out.length < ncols) out.push('')
    return out
  }
  const rows: string[][] = []
  for (let n = topNum + 2; n <= botNum; n++) rows.push(normalize(splitCells(state.doc.line(n).text)))

  let cursorRow = 0
  if (curLine.number > topNum + 1) cursorRow = curLine.number - (topNum + 1)
  const before = curLine.text.slice(0, head - curLine.from)
  const pipes = (before.match(/\|/g) || []).length
  const startsWithPipe = curLine.text.trim().startsWith('|')
  let cursorCol = startsWithPipe ? pipes - 1 : pipes
  cursorCol = Math.min(Math.max(0, cursorCol), ncols - 1)

  return { fromLine: topNum, toLine: botNum, headers, aligns: aligns.slice(0, ncols), rows, cursorRow, cursorCol }
}

export const isInTable = (view: EditorView): boolean => parseTableAt(view) !== null

function buildTable(headers: string[], aligns: Align[], rows: string[][]) {
  const ncols = headers.length
  const widths: number[] = []
  for (let c = 0; c < ncols; c++) {
    let w = headers[c].length
    for (const r of rows) w = Math.max(w, (r[c] ?? '').length)
    widths[c] = Math.max(3, w)
  }
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length))
  const sepCell = (a: Align, w: number) => {
    if (a === 'center') return ':' + '-'.repeat(Math.max(1, w - 2)) + ':'
    if (a === 'left') return ':' + '-'.repeat(Math.max(1, w - 1))
    if (a === 'right') return '-'.repeat(Math.max(1, w - 1)) + ':'
    return '-'.repeat(w)
  }
  const lines: string[] = []
  const cellStarts: number[][] = []
  let offset = 0
  const pushLine = (cells: string[], isSep: boolean) => {
    const starts: number[] = []
    let line = '|'
    for (let c = 0; c < ncols; c++) {
      line += ' '
      starts[c] = offset + line.length
      line += isSep ? sepCell(aligns[c], widths[c]) : pad(cells[c] ?? '', widths[c])
      line += ' |'
    }
    cellStarts.push(starts)
    lines.push(line)
    offset += line.length + 1
  }
  pushLine(headers, false)
  pushLine(headers, true)
  for (const r of rows) pushLine(r, false)
  const cellOffset = (row: number, col: number) => {
    const lineIdx = row === 0 ? 0 : row + 1
    const cc = Math.min(Math.max(0, col), ncols - 1)
    return cellStarts[Math.min(lineIdx, cellStarts.length - 1)]?.[cc] ?? 0
  }
  return { text: lines.join('\n'), cellOffset }
}

interface NextTable {
  headers: string[]
  aligns: Align[]
  rows: string[][]
  targetRow: number
  targetCol: number
}

function apply(view: EditorView, m: TableModel, next: NextTable) {
  const { text, cellOffset } = buildTable(next.headers, next.aligns, next.rows)
  const from = view.state.doc.line(m.fromLine).from
  const to = view.state.doc.line(m.toLine).to
  const pos = from + cellOffset(next.targetRow, next.targetCol)
  view.dispatch({ changes: { from, to, insert: text }, selection: EditorSelection.cursor(pos) })
  view.focus()
}

type TableOp = (view: EditorView) => void
const op =
  (fn: (m: TableModel) => NextTable | null): TableOp =>
  (view) => {
    const m = parseTableAt(view)
    if (!m) return
    const next = fn(m)
    if (next) apply(view, m, next)
  }

const cloneRows = (rows: string[][]) => rows.map((r) => r.slice())

export const tableAddRow = op((m) => {
  const rows = cloneRows(m.rows)
  rows.splice(m.cursorRow, 0, m.headers.map(() => ''))
  return { headers: m.headers, aligns: m.aligns, rows, targetRow: m.cursorRow + 1, targetCol: m.cursorCol }
})

export const tableRemoveRow = op((m) => {
  if (m.cursorRow === 0 || m.rows.length === 0) return null
  const rows = cloneRows(m.rows)
  rows.splice(m.cursorRow - 1, 1)
  const targetRow = Math.min(m.cursorRow, rows.length)
  return { headers: m.headers, aligns: m.aligns, rows, targetRow, targetCol: m.cursorCol }
})

export const tableMoveRowUp = op((m) => {
  if (m.cursorRow < 2) return null
  const rows = cloneRows(m.rows)
  const i = m.cursorRow - 1
  ;[rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]
  return { headers: m.headers, aligns: m.aligns, rows, targetRow: m.cursorRow - 1, targetCol: m.cursorCol }
})

export const tableMoveRowDown = op((m) => {
  if (m.cursorRow === 0 || m.cursorRow >= m.rows.length) return null
  const rows = cloneRows(m.rows)
  const i = m.cursorRow - 1
  ;[rows[i], rows[i + 1]] = [rows[i + 1], rows[i]]
  return { headers: m.headers, aligns: m.aligns, rows, targetRow: m.cursorRow + 1, targetCol: m.cursorCol }
})

const insertCol = (m: TableModel, idx: number): NextTable => {
  const headers = m.headers.slice()
  headers.splice(idx, 0, '')
  const aligns = m.aligns.slice()
  aligns.splice(idx, 0, 'none')
  const rows = m.rows.map((r) => {
    const nr = r.slice()
    nr.splice(idx, 0, '')
    return nr
  })
  return { headers, aligns, rows, targetRow: m.cursorRow, targetCol: idx }
}

export const tableAddColRight = op((m) => insertCol(m, m.cursorCol + 1))
export const tableAddColLeft = op((m) => insertCol(m, m.cursorCol))

const swapCol = (m: TableModel, a: number, b: number): NextTable | null => {
  if (a < 0 || b < 0 || a >= m.headers.length || b >= m.headers.length) return null
  const headers = m.headers.slice()
  ;[headers[a], headers[b]] = [headers[b], headers[a]]
  const aligns = m.aligns.slice()
  ;[aligns[a], aligns[b]] = [aligns[b], aligns[a]]
  const rows = m.rows.map((r) => {
    const nr = r.slice()
    ;[nr[a], nr[b]] = [nr[b], nr[a]]
    return nr
  })
  return { headers, aligns, rows, targetRow: m.cursorRow, targetCol: b }
}

export const tableMoveColLeft = op((m) => swapCol(m, m.cursorCol, m.cursorCol - 1))
export const tableMoveColRight = op((m) => swapCol(m, m.cursorCol, m.cursorCol + 1))

export const tableSetAlign = (align: Align): TableOp =>
  op((m) => {
    const aligns = m.aligns.slice()
    aligns[m.cursorCol] = align
    return { headers: m.headers, aligns, rows: m.rows, targetRow: m.cursorRow, targetCol: m.cursorCol }
  })
