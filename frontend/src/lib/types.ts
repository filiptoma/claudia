import type { RecordModel } from 'pocketbase'

export type Role = 'viewer' | 'editor' | 'admin'

// A user's stored role may be empty ('') for fresh sign-ups; treat empty as 'viewer'.
export interface UserRec extends RecordModel {
  email: string
  name: string
  role: Role | ''
  verified: boolean
}

export type Visibility = 'private' | 'public' | 'shared'

export interface Project extends RecordModel {
  name: string
  slug: string
  order: number
  visibility: Visibility | '' // '' (unset) is treated as private
  sharedUsers: string[]
}

export interface Folder extends RecordModel {
  name: string
  slug: string
  project: string
  order: number
}

export interface DocumentRec extends RecordModel {
  title: string
  slug: string
  project: string
  folder: string // '' when at project root
  content: string
  order: number
  created: string
  updated: string
}

export interface MediaRec extends RecordModel {
  file: string
  document: string
  alt: string
}

export const effectiveRole = (user: UserRec | null): Role =>
  user && (user.role === 'editor' || user.role === 'admin') ? user.role : 'viewer'
