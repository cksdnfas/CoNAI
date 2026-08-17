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

/** Build a usable filename when a single media response omits Content-Disposition. */
export function getSingleImageDownloadFallbackName(identifier: string, type: 'thumbnail' | 'original', contentType: string | null) {
  const normalizedContentType = contentType?.toLowerCase() ?? ''

  if (type === 'thumbnail') {
    return `${identifier}-thumbnail.webp`
  }

  if (normalizedContentType.includes('image/png')) {
    return `${identifier}.png`
  }
  if (normalizedContentType.includes('image/jpeg')) {
    return `${identifier}.jpg`
  }
  if (normalizedContentType.includes('image/webp')) {
    return `${identifier}.webp`
  }
  if (normalizedContentType.includes('image/gif')) {
    return `${identifier}.gif`
  }
  if (normalizedContentType.includes('video/mp4')) {
    return `${identifier}.mp4`
  }
  if (normalizedContentType.includes('video/webm')) {
    return `${identifier}.webm`
  }
  if (normalizedContentType.includes('video/quicktime')) {
    return `${identifier}.mov`
  }

  return `${identifier}.bin`
}

/** Read a useful message from failed blob download responses. */
export async function readDownloadError(response: Response, fallbackMessage?: string) {
  const contentType = response.headers.get('Content-Type') || ''

  if (contentType.includes('application/json')) {
    try {
      const payload = (await response.json()) as ApiErrorPayload
      return typeof payload.error === 'string' && payload.error.length > 0
        ? payload.error
        : fallbackMessage || `Request failed: ${response.status}`
    } catch {
      return fallbackMessage || `Request failed: ${response.status}`
    }
  }

  const text = await response.text().catch(() => '')
  return text || fallbackMessage || `Request failed: ${response.status}`
}

/** Read a blob response while preserving backend error text when the request fails. */
export async function readDownloadBlob(response: Response, fallbackMessage?: string) {
  if (!response.ok) {
    const message = await readDownloadError(response, fallbackMessage)
    throw new Error(message || fallbackMessage || `Request failed: ${response.status}`)
  }

  return response.blob()
}
