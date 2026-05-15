export interface UploadResultIdentity {
  composite_hash?: string | null
}

export function getUploadResultDetailPath(item: UploadResultIdentity) {
  const compositeHash = typeof item.composite_hash === 'string' ? item.composite_hash.trim() : ''
  return compositeHash ? `/images/${encodeURIComponent(compositeHash)}` : null
}
