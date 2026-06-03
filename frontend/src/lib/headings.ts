import GithubSlugger from 'github-slugger'

export interface DocHeading {
  /** Human-readable heading text (inline markdown stripped) — shown in the picker. */
  text: string
  /** 1–6. */
  depth: number
  /** Matches the `id` rehype-slug renders into the preview, so `#slug` links resolve. */
  slug: string
}

// Reduce inline markdown to the plain text the rendered heading ends up containing — which is what
// rehype-slug slugs. Covers the common cases (emphasis, code, links/images, stray tags).
function stripInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // image -> alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // link -> text
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/[*_~]+/g, '') // emphasis / strikethrough markers
    .replace(/<[^>]+>/g, '') // stray html
    .replace(/\s+/g, ' ')
    .trim()
}

// Parse ATX headings (`#`…`######`) from markdown, skipping fenced code blocks. Slugs are generated
// with github-slugger — the same library rehype-slug uses — in document order, so they match the
// ids rendered into the preview exactly, including the `-1`/`-2` de-duplication suffixes.
export function parseHeadings(markdown: string): DocHeading[] {
  const slugger = new GithubSlugger()
  const out: DocHeading[] = []
  let inFence = false
  let fenceChar = ''

  for (const line of markdown.split('\n')) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      const ch = fence[1][0]
      if (!inFence) {
        inFence = true
        fenceChar = ch
      } else if (ch === fenceChar) {
        inFence = false
      }
      continue
    }
    if (inFence) continue

    const m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (!m) continue
    const text = stripInline(m[2])
    if (!text) continue
    out.push({ depth: m[1].length, text, slug: slugger.slug(text) })
  }
  return out
}
