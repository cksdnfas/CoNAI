import { buildApiUrl } from '@/lib/api-client'

interface RequestJsonOptions {
  defaultCache?: RequestCache
}

type ResponsePayload = unknown

async function readResponsePayload(response: Response): Promise<ResponsePayload> {
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json') ? await response.json() : await response.text()
}

function errorMessageFromPayload(payload: ResponsePayload) {
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }

  const { error, details } = payload as Record<string, unknown>
  return (typeof error === 'string' && error) || (typeof details === 'string' && details) || undefined
}

/** Execute a JSON API request and surface backend error messages. */
export async function requestJson<T>(path: string, init?: RequestInit, options: RequestJsonOptions = {}): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: init?.credentials ?? 'include',
    cache: init?.cache ?? options.defaultCache,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw new Error(errorMessageFromPayload(payload) ?? `Request failed: ${response.status}`)
  }

  return payload as T
}
