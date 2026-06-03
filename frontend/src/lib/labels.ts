const pad = (n: number) => String(n).padStart(2, '0')

// Local date-time as DD.MM.YYYY HH:mm — the format used for a quick note's default name and dates.
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Display title for a document. A quick note has no title, so its default name is its creation
// date-time; a regular untitled doc (shouldn't happen — they require a title) falls back to a label.
export function docLabel(doc: { title: string; is_quick_note?: boolean; created_at?: string }): string {
  const title = doc.title.trim()
  if (title) return title
  if (doc.is_quick_note && doc.created_at) return formatDateTime(doc.created_at)
  return 'Untitled note'
}
