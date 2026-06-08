/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  // LaTeX engine asset hosting (all optional; sensible same-origin defaults in lib/latex/compiler.ts).
  readonly VITE_BUSYTEX_BASE_PATH?: string
  readonly VITE_TEXLIVE_REMOTE_ENDPOINT?: string
  readonly VITE_BUSYTEX_COLLECTIONS?: string
  readonly VITE_BUSYTEX_CATALOG?: string
  // Typst (markdown→PDF export) compiler WASM URL — same-origin, R2-served like busytex (too big for
  // Pages' 25 MiB cap to bundle). Default in lib/typst/compiler.ts.
  readonly VITE_TYPST_WASM_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Fontsource packages are CSS-only side-effect imports without bundled types.
declare module '@fontsource-variable/hanken-grotesk'
declare module '@fontsource-variable/jetbrains-mono'
