// Lazy, browser-only wrapper around the Typst WASM compiler (@myriaddreamin/typst.ts). It is the only
// module that touches the engine's API — everything else (mdToTypst, export) speaks plain strings and
// the small `{ source, shadows } -> Uint8Array` interface below.
//
// No cross-origin isolation: the compiler runs on plain async postMessage, so adding it does NOT
// require COOP/COEP headers (which would break Supabase signed-image <img>s). The 27 MB compiler WASM
// and the fonts are self-hosted via Vite `?url` imports (content-hashed, lazy-fetched on first export)
// — there is no compile-time network dependency (default remote font assets are disabled; we ship our
// own Hanken Grotesk + JetBrains Mono + New Computer Modern Math to match the preview, math included).

import { $typst, initOptions } from '@myriaddreamin/typst.ts'
import wasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
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
    getModule: () => wasmUrl,
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
