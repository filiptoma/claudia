// Copy the Typst compiler WASM out of node_modules into public/assets/busytex/ (gitignored), so it
// sits alongside the busytex engine assets — served by Vite's public/ in dev and by the R2-backed
// Pages Function in prod. It is NOT imported by the app (would bundle it into dist/ and blow Cloudflare
// Pages' 25 MiB per-file cap); it's fetched at runtime from the same-origin /assets/busytex/ path.
//
// Run locally before `npm run upload:wasm-assets`:  npm run assets:typst
// NEVER wire this into postinstall — on Cloudflare's build it would land the 27 MB file in public/ and
// get deployed, re-triggering the 25 MiB Pages error. It must stay a manual, local-only step.

import { copyFile, mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm')
const DEST_DIR = join(ROOT, 'public/assets/busytex')
const DEST = join(DEST_DIR, 'typst_ts_web_compiler_bg.wasm')

try {
  const { size } = await stat(SRC)
  await mkdir(DEST_DIR, { recursive: true })
  await copyFile(SRC, DEST)
  console.log(`Copied Typst compiler WASM (${(size / 1048576).toFixed(1)} MiB) →`)
  console.log(`  ${DEST}`)
  console.log('Next: `npm run upload:wasm-assets` to push it to R2.')
} catch (err) {
  if (err?.code === 'ENOENT') {
    console.error(
      'Typst WASM not found in node_modules. Run `npm install` first (it ships with ' +
        '@myriaddreamin/typst-ts-web-compiler).',
    )
  } else {
    console.error(err)
  }
  process.exit(1)
}
