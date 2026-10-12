import { requestJson as requestJsonBase } from '@/lib/api-request'

/** Execute an image-generation JSON API request without reusing browser caches by default. */
export function requestJson<T>(path: string, init?: RequestInit, options?: { timeoutMs?: number }): Promise<T> {
  return requestJsonBase<T>(path, init, { defaultCache: 'no-store', ...options })
}
