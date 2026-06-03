import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Fail loudly at startup if the (build-time) env is missing, rather than shipping
// createClient(undefined, undefined) and failing with a cryptic error at first request.
// Local: set these in frontend/.env.local. Prod: set them in the Cloudflare Pages env vars.
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY — set them in .env.local (dev) or Cloudflare Pages env vars (prod).',
  )
}

// Persist the session in localStorage and silently refresh it, so a page reload keeps the user
// signed in until they explicitly sign out (rather than re-authenticating on every refresh).
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'claudia-auth',
    flowType: 'pkce',
  },
})

// The current access token is mirrored here so non-async paths (e.g. a beforeunload keepalive
// PATCH straight to PostgREST) can read it synchronously. Kept in sync by AuthContext.
let accessToken: string | null = null
export const setAccessToken = (t: string | null) => {
  accessToken = t
}
export const getAccessToken = () => accessToken
