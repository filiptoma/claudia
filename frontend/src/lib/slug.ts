import { pb } from './pb'

// lowercase, strip accents, non-alnum -> '-', trim/collapse dashes.
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'untitled'
  )
}

// Find an available slug in `collection`, scoped by an optional extra filter (e.g. project).
// Tries base, then base-2, base-3, … by probing the unique index.
export async function uniqueSlug(
  collection: string,
  base: string,
  extraFilter = '',
): Promise<string> {
  const root = slugify(base)
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`
    const filter =
      pb.filter('slug = {:slug}', { slug: candidate }) +
      (extraFilter ? ` && (${extraFilter})` : '')
    try {
      await pb.collection(collection).getFirstListItem(filter, { requestKey: null })
      // a record with this slug exists -> keep searching
    } catch {
      return candidate // not found -> available
    }
  }
}
