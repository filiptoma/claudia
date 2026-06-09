import { supabase } from './supabase'

const BUCKET = 'media'
export const STORAGE_PREFIX = 'storage:'

// Must match the media bucket's allowed_mime_types / file_size_limit (migration 0007).
// SVG is intentionally excluded (it can carry script); the bucket enforces these server-side too.
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

// Upload to the PRIVATE media bucket under `{projectId}/{documentId}/` — the document segment lets the
// storage RLS gate the image on the DOCUMENT's access (so a private doc's images aren't readable by
// other project members, and a private-resource editor-grantee can still upload). Returns the object
// path, stored in markdown as `storage:<path>` and resolved to a signed URL at render time. Legacy
// 2-segment paths ({projectId}/file) stay project-gated — see migration 0025.
export async function uploadImage(projectId: string, documentId: string, file: File): Promise<string> {
  // Fail fast with a clear message; the bucket re-enforces both checks server-side.
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Only PNG, JPEG, GIF, WebP, or AVIF images can be uploaded.')
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large (max 10 MB).')
  }
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${projectId}/${documentId}/${crypto.randomUUID()}.${ext}`
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

const AVATAR_BUCKET = 'avatars'
const AVATAR_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const AVATAR_MAX_BYTES = 2 * 1024 * 1024 // 2 MB

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Only PNG, JPEG, WebP, or GIF images can be used as avatars.')
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error('Avatar image is too large (max 2 MB).')
  }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${userId}/avatar.${ext}`
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: true, // replace any existing avatar
  })
  if (error) throw new Error(error.message)
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl
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
