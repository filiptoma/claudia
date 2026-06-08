// The Typst preamble that mirrors the AstroNote markdown preview (`.md` in index.css) — it is the
// single source of truth for how an exported PDF looks. Colors are the OKLCH design tokens converted
// to sRGB hex (light mode, since the PDF is always on white); the type scale, spacing and accents are
// matched to index.css:248-560 so the exported document reads like the on-screen preview.
//
// The generated body (see mdToTypst.ts) is plain Typst markup that leans on the helpers defined here
// (`mdhr`, `blockquote`, `mdimage`, `mdtable`, `taskmark`).

// --- colors (OKLCH tokens → sRGB hex, see index.css:21-82) -----------------------------------------
export const TYPST_COLORS = {
  foreground: '#171717', // --foreground oklch(0.205 0 0)
  muted: '#636363', //       --muted-foreground oklch(0.5 0 0)
  border: '#dedede', //      --border oklch(0.9 0 0)
  surface: '#f2f2f2', //     --muted oklch(0.96 0 0) — code/table-header fill
  zebra: '#f6f6f6', //       table even-row tint (foreground @ 4% over white)
  primary: '#eebd30', //     --primary oklch(0.82 0.155 88) — blockquote rail / task fill
  code: '#945a00', //        --code oklch(0.52 0.13 74) — inline-code text
  codeChip: '#f1edde', //    inline-code chip (primary @ 10% over --muted)
  quote: '#fdfaee', //       blockquote fill (primary @ 8% over white)
  link: '#4a2fed', //        --accent2 oklch(0.487 0.261 277) — links
  plateBorder: '#d9d9d9', // image plate border (--plate-border, lightened)
} as const

// Escape a value for inclusion inside a Typst string literal ("...").
export function typstString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/**
 * Wrap a generated Typst markup `body` in the AstroNote preamble. `title` (if given) becomes the PDF
 * document title metadata. Fonts are referenced by family name; the actual `.ttf`/`.otf` binaries are
 * registered with the compiler at runtime (compiler.ts), so this string carries no font data.
 */
export function buildTypstDocument(body: string, opts: { title?: string } = {}): string {
  const c = TYPST_COLORS
  const titleMeta = opts.title ? `#set document(title: ${typstString(opts.title)})\n` : ''
  return `${titleMeta}#set page(paper: "a4", margin: (x: 2.2cm, top: 2.2cm, bottom: 2.4cm))
#set text(font: ("Hanken Grotesk",), size: 11pt, fill: rgb("${c.foreground}"), lang: "en")
// leading 1em ⇒ ~1.7em line pitch (matches .md line-height: 1.7); spacing 2.2em is the inter-block
// gap — in Typst a block gap *replaces* the inter-line leading, so it must equal one line (1.7em) plus
// the .md 1.28rem block margin to reproduce the on-screen baseline-to-baseline (see index.css:251-253).
#set par(leading: 1em, spacing: 2.2em, justify: false)
#show link: it => text(fill: rgb("${c.link}"), weight: 500, it)

// Headings — unnumbered, scaled to mirror the .md preview type ramp. above/below reproduce the shared
// 2.2rem top / per-level bottom margins (index.css:272-303). Smaller levels need a *larger* above
// because their shorter ascenders contribute less of the visible gap than a big H1's do, so a flat
// value would leave them looking cramped; the bottoms all clamp to the 2.2em block spacing anyway.
#show heading: set text(fill: rgb("${c.foreground}"))
#show heading.where(level: 1): it => block(above: 2.2em, below: 2.2em, text(size: 23pt, weight: 800, it.body))
#show heading.where(level: 2): it => block(width: 100%, above: 2.55em, below: 2.2em, stroke: (bottom: 0.6pt + rgb("${c.border}")), inset: (bottom: 0.32em), text(size: 16.5pt, weight: 750, it.body))
#show heading.where(level: 3): it => block(above: 3em, below: 2.2em, text(size: 14pt, weight: 750, it.body))
#show heading.where(level: 4): it => block(above: 3em, below: 2.2em, text(size: 12pt, weight: 750, it.body))
#show heading.where(level: 5): it => block(above: 3em, below: 2.2em, text(size: 11pt, weight: 700, fill: rgb("${c.muted}"), it.body))
#show heading.where(level: 6): it => block(above: 3em, below: 2.2em, text(size: 11pt, weight: 700, fill: rgb("${c.muted}"), it.body))

// Code — JetBrains Mono; inline on a warm chip, blocks on a bordered surface (auto-highlighted).
#show raw: set text(font: ("JetBrains Mono",))
#show raw.where(block: false): it => box(fill: rgb("${c.codeChip}"), inset: (x: 0.35em), outset: (y: 0.28em), radius: 3pt, text(fill: rgb("${c.code}"), size: 0.86em, it))
#show raw.where(block: true): it => block(width: 100%, above: 2.2em, below: 2.2em, fill: rgb("${c.surface}"), stroke: 0.6pt + rgb("${c.border}"), inset: (x: 1em, y: 0.85em), radius: 5pt, text(size: 9.3pt, it))

// Lists — item spacing matches the body line pitch (tight .md lists have no per-item margin).
#set list(marker: ([•], [◦], [▪]), spacing: 1em)
#set enum(spacing: 1em)

// --- helpers used by the generated body ---
#let mdhr = block(above: 2.2em, below: 2.2em, line(length: 100%, stroke: 0.6pt + rgb("${c.border}")))
#let blockquote(body) = block(width: 100%, above: 2.2em, below: 2.2em, fill: rgb("${c.quote}"), inset: (x: 1em, y: 0.65em), radius: (top-right: 5pt, bottom-right: 5pt), stroke: (left: 2.5pt + rgb("${c.primary}")), body)
#let mdimage(path, width: auto) = block(above: 2.2em, below: 2.2em, align(center, block(fill: white, stroke: 0.6pt + rgb("${c.plateBorder}"), inset: 8pt, radius: 5pt, image(path, width: width))))
#let taskmark(checked) = box(baseline: 0.12em, height: 0.82em, width: 0.82em, radius: 2pt, stroke: 0.08em + rgb("#9a7b1c"), fill: if checked { rgb("${c.primary}") } else { white })
#let mdtable(cols: 1, aligns: (), header: (), rows: ()) = block(above: 1.25em, below: 1.25em, table(
  columns: cols,
  align: (col, row) => aligns.at(col, default: left),
  stroke: 0.6pt + rgb("${c.border}"),
  inset: (x: 0.7em, y: 0.5em),
  fill: (col, row) => if row == 0 { rgb("${c.surface}") } else if calc.even(row) { rgb("${c.zebra}") } else { white },
  ..if header.len() > 0 { (table.header(..header),) } else { () },
  ..rows.flatten(),
))

${body}
`
}
