type ApiErrorPayload = {
  error?: unknown
}

/** Extract a suggested filename from Content-Disposition when available. */
export function getDownloadFileName(contentDisposition: string | null, fallbackFileName: string) {
  if (!contentDisposition) {
    return fallbackFileName
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1])
  }

  const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
  if (basicMatch?.[1]) {
    return basicMatch[1]
  }

  return fallbackFileName
}

/** Read a useful message from failed blob download responses. */
export async function readDownloadError(response: Response) {
  const contentType = response.headers.get('Content-Type') || ''

  if (contentType.includes('application/json')) {
    try {
      const payload = (await response.json()) as ApiErrorPayload
      return typeof payload.error === 'string' && payload.error.length > 0
        ? payload.error
        : `Request failed: ${response.status}`
    } catch {
      return `Request failed: ${response.status}`
    }
  }

  const text = await response.text().catch(() => '')
  return text || `Request failed: ${response.status}`
}
