import PocketBase from 'pocketbase'
import type { RecordModel } from 'pocketbase'

export const PB_URL = import.meta.env.VITE_PB_URL || 'http://127.0.0.1:8090'

export const pb = new PocketBase(PB_URL)

// Public file URL for a record's file field (current SDK uses uppercase getURL).
export function fileUrl(record: RecordModel, filename: string): string {
  return pb.files.getURL(record, filename)
}
