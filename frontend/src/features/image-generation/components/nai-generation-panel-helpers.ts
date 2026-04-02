/** Build a human-readable asset label from one optional file name. */
export function deriveNaiAssetLabel(fileName: string | undefined, fallback: string) {
  const trimmed = fileName?.trim()
  if (!trimmed) {
    return fallback
  }

  return trimmed.replace(/\.[^/.]+$/, '') || fallback
}

/** Build one edited image file name while preserving the source label when possible. */
export function buildNaiEditedImageFileName(fileName: string | undefined, fallback: string) {
  return `${deriveNaiAssetLabel(fileName, fallback)}-edited.png`
}

/** Convert a base64 PNG payload into a Blob download. */
export function decodeNaiBase64Png(data: string) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: 'image/png' })
}
