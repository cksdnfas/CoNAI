import { pluginNativeApiPath } from '@conai/shared'
import { buildApiUrl } from '@/lib/api-url'
import { ApiRequestError } from '@/lib/api-request'
import { pluginRequest } from '@/lib/api-plugins'
import { UPLOAD_LIMITS } from '@/lib/upload-limits'

type NativeInput = { path: string; method?: string; headers?: Record<string, string>; body?: string | Blob | ArrayBuffer; form?: Array<{ name: string; value: string | Blob; filename?: string }> }
export type PluginNativeResponse = { status: number; statusText: string; headers: Array<[string, string]>; body: ReadableStream<Uint8Array> | null }

/** Use native HTTP validation and permissions, including multipart/streaming, without copying bytes into JSON. */
export async function fetchPluginNative(instanceId: string, value: unknown, signal: AbortSignal, review: (path: string, method: string, details: string) => Promise<boolean>): Promise<Response> {
  if (!value || typeof value !== 'object') throw new ApiRequestError('앱 요청 형식이 올바르지 않아.', 400, 'INVALID_INPUT')
  const input = value as NativeInput
  const path = pluginNativeApiPath(input.path, [window.location.origin, new URL(buildApiUrl('/'), window.location.href).origin])
  const method = input.method?.toUpperCase() ?? 'GET'
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new ApiRequestError('지원하지 않는 HTTP 메서드야.', 400)
  const headers = new Headers()
  for (const [name, content] of Object.entries(input.headers ?? {})) {
    if (!['accept', 'content-type', 'if-match', 'if-none-match', 'range'].includes(name.toLowerCase()) || typeof content !== 'string' || content.length > 1000) throw new ApiRequestError('이 요청 헤더는 사용할 수 없어.', 400)
    headers.set(name, content)
  }
  let body: BodyInit | undefined
  if (input.form !== undefined) {
    if (!Array.isArray(input.form) || input.form.length > 100 || input.body !== undefined) throw new ApiRequestError('업로드 형식이 올바르지 않아.', 400)
    const form = new FormData()
    let bytes = 0, files = 0
    for (const field of input.form) {
      if (typeof field.name !== 'string' || field.name.length > 100) throw new ApiRequestError('업로드 필드 이름이 올바르지 않아.', 400)
      if (field.value instanceof Blob) {
        if (++files > UPLOAD_LIMITS.maxFilesPerRequest || field.value.size > UPLOAD_LIMITS.maxFileBytes) throw new ApiRequestError('앱 업로드 한도를 넘었어.', 413)
        bytes += field.value.size
        form.append(field.name, field.value, field.filename ?? 'upload')
      } else if (typeof field.value === 'string') {
        bytes += new Blob([field.value]).size
        form.append(field.name, field.value)
      } else throw new ApiRequestError('업로드 필드 값이 올바르지 않아.', 400)
    }
    if (bytes > UPLOAD_LIMITS.maxRequestBytes) throw new ApiRequestError('앱 업로드 한도를 넘었어.', 413)
    headers.delete('content-type')
    body = form
  } else if (input.body !== undefined) {
    if (!(typeof input.body === 'string' || input.body instanceof Blob || input.body instanceof ArrayBuffer)) throw new ApiRequestError('body에는 문자열·Blob·ArrayBuffer 또는 FormData를 사용해줘.', 400)
    if (new Blob([input.body]).size > UPLOAD_LIMITS.maxRequestBytes) throw new ApiRequestError('앱 요청 한도를 넘었어.', 413)
    body = input.body
  }
  if ((method === 'GET' || method === 'HEAD') && body !== undefined) throw new ApiRequestError('조회 요청에는 본문을 넣을 수 없어.', 400)
  const details = input.form ? JSON.stringify(input.form.map(field => ({ field: field.name, ...(field.value instanceof Blob ? { filename: field.filename, bytes: field.value.size } : { value: field.value }) })), null, 2)
    : typeof input.body === 'string' ? input.body : input.body ? `${new Blob([input.body]).size} bytes` : ''
  if (!['GET', 'HEAD'].includes(method) && !await review(path, method, details)) throw new DOMException('작업을 취소했어.', 'AbortError')
  signal.throwIfAborted()
  // Every call rechecks the installed version, account and session; a cached page cannot outlive disable/logout.
  await pluginRequest(`/instances/${instanceId}`, 'GET', undefined, signal)
  return fetch(buildApiUrl(path), { method, headers, body, credentials: 'include', redirect: 'error', cache: 'no-store', signal })
}

/** Keep backpressure/cancellation through the transferred stream; no whole-file buffering in the host. */
export function pluginNativeResponse(response: Response, finish: () => void): PluginNativeResponse {
  const reader = response.body?.getReader()
  const body = reader ? new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { const chunk = await reader.read(); if (chunk.done) { controller.close(); finish() } else controller.enqueue(chunk.value) }
      catch (error) { controller.error(error); finish() }
    },
    async cancel(reason) { try { await reader.cancel(reason) } finally { finish() } },
  }) : null
  if (!body) finish()
  return { status: response.status, statusText: response.statusText, headers: [...response.headers].filter(([key]) => key !== 'set-cookie'), body }
}
