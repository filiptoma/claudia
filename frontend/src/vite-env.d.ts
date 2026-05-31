/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Fontsource packages are CSS-only side-effect imports without bundled types.
declare module '@fontsource-variable/inter'
declare module '@fontsource-variable/jetbrains-mono'
