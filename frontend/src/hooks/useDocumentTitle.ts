import { useEffect } from 'react'
import { APP_NAME } from '../lib/brand'

// Sets the browser tab title for the current view. Every routed screen calls this, so the tab
// always reflects what's on screen and never shows a stale title after navigation.
//
// The app name is appended as a " - AstroNote" suffix, except when the title already contains the
// app name (the home/dashboard title is just "AstroNote") — so it never doubles up into
// "AstroNote - AstroNote". A missing/empty title falls back to the bare app name.
export function useDocumentTitle(title?: string | null): void {
  useEffect(() => {
    const base = title && title.trim() ? title.trim() : APP_NAME
    document.title = base.includes(APP_NAME) ? base : `${base} - ${APP_NAME}`
  }, [title])
}
