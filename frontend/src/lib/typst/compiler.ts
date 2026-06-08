// Lazy, browser-only wrapper around the Typst WASM compiler (@myriaddreamin/typst.ts). It is the only
// module that touches the engine's API — everything else (mdToTypst, export) speaks plain strings and
// the small `{ source, shadows } -> Uint8Array` interface below.
//
// No cross-origin isolation: the compiler runs on plain async postMessage, so adding it does NOT
// require COOP/COEP headers (which would break Supabase signed-image <img>s).
//
// The 27 MB compiler WASM is NOT bundled by Vite — at 27 MB it exceeds Cloudflare Pages' 25 MiB
// per-file deploy cap, so (exactly like the busytex engine) it is self-hosted from the R2-backed
// same-origin path below and fetched lazily on first export. In dev Vite serves it from
// `public/assets/busytex/`; in prod the Pages Function fronts R2. Run `npm run assets:typst` to drop
// the file into public/ (gitignored), then `npm run upload:tex-assets` to push it to R2. The fonts
// stay as Vite `?url` imports (each well under 25 MiB, so they deploy fine) so the PDF matches the
// preview — default remote font assets are disabled; we ship Hanken Grotesk + JetBrains Mono + NewCM.

import { $typst, initOptions } from '@myriaddreamin/typst.ts'

// Same-origin URL the compiler WASM is fetched from (env-overridable so prod can repoint without a
// code change). Lives alongside the busytex engine assets in R2; served by the same Pages Function.
const TYPST_WASM_URL =
  import.meta.env.VITE_TYPST_WASM_URL ?? '/assets/busytex/typst_ts_web_compiler_bg.wasm'
// Static Hanken Grotesk instances — Typst 0.13 does not support variable fonts, so we ship one file
// per weight the template requests (400/500/600/700/800 + italics).
import hankenRegularUrl from '../../assets/fonts/HankenGrotesk-Regular.ttf?url'
import hankenMediumUrl from '../../assets/fonts/HankenGrotesk-Medium.ttf?url'
import hankenSemiBoldUrl from '../../assets/fonts/HankenGrotesk-SemiBold.ttf?url'
import hankenBoldUrl from '../../assets/fonts/HankenGrotesk-Bold.ttf?url'
import hankenExtraBoldUrl from '../../assets/fonts/HankenGrotesk-ExtraBold.ttf?url'
import hankenItalicUrl from '../../assets/fonts/HankenGrotesk-Italic.ttf?url'
import hankenBoldItalicUrl from '../../assets/fonts/HankenGrotesk-BoldItalic.ttf?url'
import jbmRegularUrl from '../../assets/fonts/JetBrainsMono-Regular.ttf?url'
import jbmBoldUrl from '../../assets/fonts/JetBrainsMono-Bold.ttf?url'
import jbmItalicUrl from '../../assets/fonts/JetBrainsMono-Italic.ttf?url'
import jbmBoldItalicUrl from '../../assets/fonts/JetBrainsMono-BoldItalic.ttf?url'
import mathUrl from '../../assets/fonts/NewCMMath-Regular.otf?url'

const FONT_URLS = [
  hankenRegularUrl,
  hankenMediumUrl,
  hankenSemiBoldUrl,
  hankenBoldUrl,
  hankenExtraBoldUrl,
  hankenItalicUrl,
  hankenBoldItalicUrl,
  jbmRegularUrl,
  jbmBoldUrl,
  jbmItalicUrl,
  jbmBoldItalicUrl,
  mathUrl,
]

export interface TypstShadowFile {
  /** Absolute virtual path the compiler resolves, e.g. `/img/0.png`. */
  path: string
  bytes: Uint8Array
}

let configured = false
function configure() {
  if (configured) return
  $typst.setCompilerInitOptions({
    getModule: () => TYPST_WASM_URL,
    beforeBuild: [initOptions.disableDefaultFontAssets(), initOptions.loadFonts(FONT_URLS)],
  })
  configured = true
}

// `$typst` is a process-wide singleton whose shadow FS and compile state are mutated per call, so
// overlapping compiles would corrupt each other. Serialize them through a single promise chain.
let queue: Promise<unknown> = Promise.resolve()

/** Compile a full Typst document (preamble + body) to PDF bytes, with `shadows` as in-memory assets. */
export function compileTypstToPdf(source: string, shadows: TypstShadowFile[] = []): Promise<Uint8Array> {
  configure()
  const run = queue.then(async () => {
    await $typst.resetShadow()
    for (const f of shadows) await $typst.mapShadow(f.path, f.bytes)
    try {
      const pdf = await $typst.pdf({ mainContent: source })
      if (!pdf) throw new Error('Typst produced no PDF output.')
      return pdf
    } finally {
      await $typst.resetShadow()
    }
  })
  // Keep the chain alive even if this compile rejects, so the next export isn't blocked.
  queue = run.catch(() => {})
  return run
}
