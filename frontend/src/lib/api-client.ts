import { createApiFallbackError, type ApiErrorFallbackKey } from '@/i18n/api-error-fallbacks'
import { requestJson, type ApiEnvelope } from '@/lib/api-request'

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(path, init)
}

export async function fetchRequiredApiData<T>(path: string, fallbackKey: ApiErrorFallbackKey, init?: RequestInit) {
  const response = await fetchJson<ApiEnvelope<T | undefined>>(path, init)
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, fallbackKey)
  }
  return response.data
}

export async function fetchApiData<T>(path: string, fallbackKey: ApiErrorFallbackKey, init?: RequestInit) {
  const response = await fetchJson<ApiEnvelope<T>>(path, init)
  if (!response.success) {
    throw createApiFallbackError(response.error, fallbackKey)
  }
  return response.data
}

export { buildApiUrl } from '@/lib/api-url'

export function triggerBrowserDownload(url: string, filename?: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  if (filename) {
    anchor.download = filename
  }
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  try {
    triggerBrowserDownload(objectUrl, filename)
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
  }
}
