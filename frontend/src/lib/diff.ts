export type DiffOp = 'equal' | 'delete' | 'insert'

export interface DiffSegment {
  op: DiffOp
  text: string
}

// LCS dynamic-programming table over string arrays.
function buildLcsTable(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp
}

function lcsBacktrack(dp: number[][], a: string[], b: string[]): Array<{ op: DiffOp; val: string }> {
  const ops: Array<{ op: DiffOp; val: string }> = []
  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ op: 'equal', val: a[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ op: 'insert', val: b[j - 1] })
      j--
    } else {
      ops.push({ op: 'delete', val: a[i - 1] })
      i--
    }
  }
  ops.reverse()
  return ops
}

function appendSeg(list: DiffSegment[], op: DiffOp, ch: string) {
  const last = list[list.length - 1]
  if (last && last.op === op) last.text += ch
  else list.push({ op, text: ch })
}

// Split into word-ish tokens — runs of whitespace, alphanumerics, or punctuation — so the diff is
// word-level (a changed word reads as the whole old word out, the whole new word in) rather than a
// character soup. Every character lands in exactly one token, so the tokens rejoin to the original.
function tokenizeWords(s: string): string[] {
  return s.match(/(\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+)/gu) ?? []
}

/**
 * Word-level diff between two strings, returned as a single ordered (interleaved) sequence of
 * equal / delete / insert runs — like `git diff --word-diff`. Deletions and insertions appear at the
 * exact positions they occur, not grouped at the end. Capped at 500 tokens/side to keep O(n·m) fast.
 */
export function diffSegments(from: string, to: string): DiffSegment[] {
  const a = tokenizeWords(from)
  const b = tokenizeWords(to)
  if (a.length > 500 || b.length > 500) {
    const segs: DiffSegment[] = []
    if (from) segs.push({ op: 'delete', text: from })
    if (to) segs.push({ op: 'insert', text: to })
    return segs
  }
  const ops = lcsBacktrack(buildLcsTable(a, b), a, b)
  const segs: DiffSegment[] = []
  for (const { op, val } of ops) appendSeg(segs, op, val)
  return segs
}

export interface DiffRow {
  // 'change' = a deleted line paired with an inserted line, shown as one row with an inline char diff.
  type: 'context' | 'delete' | 'insert' | 'change'
  text: string
  segments?: DiffSegment[]
}

// Line-level diff of two multi-line strings. Consecutive delete+insert pairs collapse into a single
// 'change' row carrying the interleaved character diff of the two lines.
export function diffRows(original: string, suggested: string): DiffRow[] {
  const aLines = original.split('\n')
  const bLines = suggested.split('\n')
  const ops = lcsBacktrack(buildLcsTable(aLines, bLines), aLines, bLines)
  const rows: DiffRow[] = []
  let i = 0
  while (i < ops.length) {
    const cur = ops[i]
    const next = ops[i + 1]
    if (cur.op === 'delete' && next?.op === 'insert') {
      rows.push({ type: 'change', text: '', segments: diffSegments(cur.val, next.val) })
      i += 2
    } else {
      rows.push({ type: cur.op === 'equal' ? 'context' : cur.op === 'delete' ? 'delete' : 'insert', text: cur.val })
      i++
    }
  }
  return rows
}
