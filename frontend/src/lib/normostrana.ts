import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import stripMarkdown from 'strip-markdown'

// "Normostrana" (NS) — the Czech/Slovak standard page: a unit for measuring text length, defined as
// **1 800 characters including spaces and punctuation** (normostrana.eu). Number of pages = characters
// with spaces / 1800; the precise/fair presentation is two decimals.
//
// We count the RENDERED prose, not the raw markdown: the source is stripped of formatting syntax
// (headings markers, emphasis, link/image syntax, list bullets, …) down to plain text, then whitespace
// is collapsed the way the rendered HTML would collapse it. So `**bold**` counts as 4 chars, not 8, and
// `# Title` as "Title". (Inline math like `$x$` is counted as typed — its `$` are negligible.)

const CHARS_PER_PAGE = 1800

// Built once and reused: parse markdown → strip all formatting to text → stringify as plain text.
const toText = unified().use(remarkParse).use(remarkGfm).use(stripMarkdown).use(remarkStringify)

/** Strip markdown to its rendered plain text, with runs of whitespace collapsed to single spaces. */
export function toPlainText(markdown: string): string {
  if (!markdown) return ''
  return String(toText.processSync(markdown))
    .replace(/\s+/g, ' ')
    .trim()
}

export interface NormostranaCount {
  /** Rendered characters including spaces. */
  chars: number
  /** Standard pages = chars / 1800 (unrounded). */
  pages: number
}

/** Count the normostrana of a markdown document (rendered text, characters-with-spaces ÷ 1 800). */
export function countNormostrana(markdown: string): NormostranaCount {
  const chars = toPlainText(markdown).length
  return { chars, pages: chars / CHARS_PER_PAGE }
}
