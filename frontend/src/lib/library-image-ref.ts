import { buildApiUrl } from './api-url'

/** A library image used as a value (workflow node inputs, run inputs): only its id is stored. */
export type LibraryImageRef = { composite_hash: string }

const MEDIA_HASH = /^(?:[a-f0-9]{48}|[a-f0-9]{32})$/

export function isLibraryImageRef(value: unknown): value is LibraryImageRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const hash = (value as { composite_hash?: unknown }).composite_hash
  return typeof hash === 'string' && MEDIA_HASH.test(hash)
}

/** What an image element can show for an image value: a data or web URL as is, a library ref as its file URL. */
export function getImageValueSrc(value: unknown): string | null {
  if (isLibraryImageRef(value)) return buildApiUrl(`/api/images/${encodeURIComponent(value.composite_hash)}/file`)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/') ? trimmed : null
}
