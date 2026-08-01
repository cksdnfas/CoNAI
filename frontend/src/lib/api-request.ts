import { buildApiUrl } from '@/lib/api-client'

const DEFAULT_TIMEOUT_MS = 30_000
const LONG_RUNNING_TIMEOUT_MS = 300_000
// Payload uploads have no predictable ceiling on a slow link, and aborting one mid-flight is
// worse than waiting, so they opt out of the timeout entirely instead of using a larger one.
const UPLOAD_TIMEOUT_MS = 0

// Endpoints that legitimately run long (external generation APIs, filesystem scans,
// bulk cleanup/import work). Uploads are exempted separately via their request bodies.
const LONG_RUNNING_PATH_PREFIXES = [
  '/api/nai/generate/',
  '/api/custom-dropdown-lists/scan-comfyui-models',
  '/api/graph-workflows/artifacts/delete-scope',
  '/api/graph-workflows/executions/cleanup-empty',
  '/api/graph-workflows/import',
  '/api/generation-history/cleanup-failed',
]

interface RequestJsonOptions {
  defaultCache?: RequestCache
  /** Abort timeout in milliseconds; pass 0 to disable the default timeout. */
  timeoutMs?: number
}

/** Detect bodies that stream a payload up to the server (FormData, raw binary). */
function isUploadRequest(init?: RequestInit) {
  const body = init?.body
  return body instanceof FormData
    || body instanceof Blob
    || body instanceof ArrayBuffer
    || ArrayBuffer.isView(body)
}

function isLongRunningRequest(path: string) {
  return LONG_RUNNING_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
}

function resolveRequestTimeoutMs(path: string, init?: RequestInit) {
  if (isUploadRequest(init)) {
    return UPLOAD_TIMEOUT_MS
  }

  return isLongRunningRequest(path) ? LONG_RUNNING_TIMEOUT_MS : DEFAULT_TIMEOUT_MS
}

function resolveRequestSignal(path: string, init: RequestInit | undefined, options: RequestJsonOptions) {
  if (init?.signal) {
    return init.signal
  }

  const timeoutMs = options.timeoutMs ?? resolveRequestTimeoutMs(path, init)
  return timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
}

type ResponsePayload = unknown

export interface ApiEnvelope<T> {
  success: boolean
  data: T
  error?: string
}

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

/** Execute a JSON API request with a default abort timeout and surface backend error messages. */
export async function requestJson<T>(path: string, init?: RequestInit, options: RequestJsonOptions = {}): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: init?.credentials ?? 'include',
    cache: init?.cache ?? options.defaultCache,
    signal: resolveRequestSignal(path, init, options),
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

/** Execute an API-envelope JSON request and return the successful data payload. */
export async function requestApiData<T>(path: string, init?: RequestInit, options: RequestJsonOptions = {}) {
  const payload = await requestJson<ApiEnvelope<T>>(path, init, options)
  if (!payload.success) {
    throw new Error(payload.error || 'Request failed')
  }

  return payload.data
}
