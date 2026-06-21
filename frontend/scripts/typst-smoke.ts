// Smoke test for the Markdown → Typst → PDF pipeline (M6). Drives the REAL mdToTypst/template code
// and compiles the result with the actual Typst WASM engine + the self-hosted fonts, in Node. Bundle
// with rolldown (keeping @myriaddreamin/* external) then run — see scripts/run-typst-smoke.sh.
//
// Asserts: a `%PDF` document is produced, an image shadow file is embedded, and `$…$`/`$$…$$` math
// (converted from LaTeX via tex2typst) compiles. Writes the PDF to /tmp/typst-smoke.pdf for eyeballing.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'
import { $typst } from '@myriaddreamin/typst.ts'
import { TypstSnippet } from '@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs'
import { parseMarkdown, collectImageSrcs, mdastToTypst } from '../src/lib/typst/mdToTypst'
import { buildTypstDocument } from '../src/lib/typst/template'

// Resolve from the frontend dir (the run script cd's there) — robust to where the bundle is emitted.
const here = (p: string) => resolve(process.cwd(), p)

const SAMPLE = `# Heading One

A paragraph with **bold**, *italic*, ~~strike~~, \`inline code\`, a [link](https://example.com),
and tricky literals: C# costs $5, a_b, <tag>, [x] = y, // not a comment, - leading dash.

## Heading Two

### Heading Three

- bullet one
- bullet two
  - nested
1. first
2. second

- 1. ahoj

  cau

- 2. ahoj

- [x] done task
- [ ] todo task

> A blockquote with a **strong** word.

\`\`\`js
function add(a, b) {
  return a + b // sum
}
\`\`\`

| Left | Center | Right |
| :--- | :----: | ----: |
| a | b | c |
| 1 | 2 | 3 |

![diagram](test.png)

Inline math $\\frac{a}{b} + \\sum_{i=1}^{n} i^2$ and a display block:

$$
\\int_0^\\infty e^{-x} \\, dx = 1
$$

---

Done.
`

// --- build the Typst document via the real walker ---
const tree = parseMarkdown(SAMPLE)
const srcs = collectImageSrcs(tree)
console.log('image srcs:', srcs)
const imagePaths = new Map(srcs.map((s, i) => [s, `/img/${i}.png`]))
const body = mdastToTypst(tree, { imagePaths })
const doc = buildTypstDocument(body, { title: 'Smoke Test' })
console.log('\n================ GENERATED TYPST ================\n' + doc + '\n=================================================\n')

// --- compile with the real engine ---
const wasmBytes = new Uint8Array(
  readFileSync(here('node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm')),
)
const fontFiles = [
  'HankenGrotesk-Regular.ttf',
  'HankenGrotesk-Medium.ttf',
  'HankenGrotesk-SemiBold.ttf',
  'HankenGrotesk-Bold.ttf',
  'HankenGrotesk-ExtraBold.ttf',
  'HankenGrotesk-Italic.ttf',
  'HankenGrotesk-BoldItalic.ttf',
  'JetBrainsMono-Regular.ttf',
  'JetBrainsMono-Bold.ttf',
  'JetBrainsMono-Italic.ttf',
  'JetBrainsMono-BoldItalic.ttf',
  'NewCMMath-Regular.otf',
]
const fontBytes = fontFiles.map((f) => new Uint8Array(readFileSync(here('src/assets/fonts/' + f))))

// Build a valid solid-color PNG so the image shadow resolves to real bytes (no hand-coded base64).
const pngBytes = makeSolidPng(4, 4, 238, 189, 48)

$typst.setCompilerInitOptions({ getModule: () => wasmBytes })
$typst.use(TypstSnippet.disableDefaultFontAssets())
for (const b of fontBytes) $typst.use(TypstSnippet.preloadFontData(b))

await $typst.resetShadow()
for (const path of imagePaths.values()) await $typst.mapShadow(path, pngBytes)

const pdf = await $typst.pdf({ mainContent: doc })
if (!pdf || pdf.length === 0) throw new Error('FAIL: no PDF output')
const header = new TextDecoder().decode(pdf.slice(0, 5))
if (!header.startsWith('%PDF')) throw new Error('FAIL: output is not a PDF (header=' + header + ')')

writeFileSync('/tmp/typst-smoke.pdf', pdf)
console.log(`PASS: produced ${pdf.length} byte PDF (header "${header}") → /tmp/typst-smoke.pdf`)

// Minimal valid RGB PNG encoder (filter 0 rows, single IDAT) using node:zlib for deflate + CRC.
function makeSolidPng(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const typeBuf = Buffer.from(type, 'ascii')
    const body = Buffer.concat([typeBuf, data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0, 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3)
    raw[row] = 0 // filter: none
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 3
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return new Uint8Array(png)
}
