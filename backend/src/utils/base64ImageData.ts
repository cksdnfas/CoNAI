/** Accept either raw base64 or an image data URL and always return raw base64. */
export function normalizeBase64ImageData(value?: string): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined
  }

  return value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, '')
}
