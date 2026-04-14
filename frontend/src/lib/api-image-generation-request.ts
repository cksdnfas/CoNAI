import { buildApiUrl } from '@/lib/api-client'

/** Execute a JSON API request and surface backend error messages. */
export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: init?.credentials ?? 'include',
    cache: init?.cache ?? 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    if (typeof payload === 'string' && payload.trim().length > 0) {
      throw new Error(payload)
    }

    if (payload && typeof payload === 'object') {
      const errorMessage =
        ('error' in payload && typeof payload.error === 'string' && payload.error) ||
        ('details' in payload && typeof payload.details === 'string' && payload.details)

      if (errorMessage) {
        throw new Error(errorMessage)
      }
    }

    throw new Error(`Request failed: ${response.status}`)
  }

  return payload as T
}
