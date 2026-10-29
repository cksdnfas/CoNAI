type TrustedGraphMedia = { filePath: string; fileName: string; mimeType: string }

const trustedMedia = new WeakMap<object, TrustedGraphMedia>()

/** A path-bearing graph artifact cannot be recreated by a JSON request. */
export function createTrustedGraphMedia(filePath: string, fileName: string, mimeType: string) {
  const value = { fileName, mimeType }
  trustedMedia.set(value, { filePath, fileName, mimeType })
  return value
}

export function getTrustedGraphMedia(value: unknown): TrustedGraphMedia | undefined {
  return value && typeof value === 'object' ? trustedMedia.get(value) : undefined
}
