import { supabase } from './supabase'

const BUCKET = 'media'
export const STORAGE_PREFIX = 'storage:'

// Must match the media bucket's allowed_mime_types / file_size_limit (migration 0007).
// SVG is intentionally excluded (it can carry script); the bucket enforces these server-side too.
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

// Upload to the PRIVATE media bucket under the project's folder. Returns the object path,
// which we store in markdown as `storage:<path>` and resolve to a signed URL at render time.
export async function uploadImage(projectId: string, file: File): Promise<string> {
  // Fail fast with a clear message; the bucket re-enforces both checks server-side.
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Only PNG, JPEG, GIF, WebP, or AVIF images can be uploaded.')
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large (max 10 MB).')
  }
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${projectId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return path
}

// Pull all `storage:<path>` references out of a document's markdown.
export function extractStoragePaths(content: string): string[] {
  const re = /storage:([^)\s"'<>]+)/g
  const set = new Set<string>()
  for (const m of content.matchAll(re)) set.add(m[1])
  return [...set]
}

// Batch-resolve storage paths to short-lived signed URLs (private bucket).
export async function signImages(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
  if (error || !data) return {}
  const out: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) out[item.path] = item.signedUrl
  return out
}
