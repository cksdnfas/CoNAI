import { type GraphWorkflowNode } from '../../types/moduleGraph'
import fs from 'fs'
import path from 'path'
import { resolveUploadsPath } from '../../config/runtimePaths'
import { buildRuntimeArtifact, completeSystemNode } from './system-module-artifacts'
import {
  bufferToDataUrl,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'

type ApiKeyValueEntry = {
  key?: unknown
  value?: unknown
}

type NormalizedDataUrl = {
  mimeType: string
  base64: string
  buffer: Buffer
}

type ApiMultipartFileValue = NormalizedDataUrl & {
  fileName?: string
}

type ApiFileReference = {
  filePath: string
  mimeType: string
  fileName: string
}

const API_VALUES_FIELD_PREFIX = 'values.'
const API_HEADERS_FIELD_PREFIX = 'headers.'
const API_REQUEST_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const DATA_URL_PATTERN = /^data:([^;,]+)?;base64,([a-zA-Z0-9+/=\s]+)$/
const TEXT_RESPONSE_CONTENT_TYPES = [
  'application/json',
  'application/problem+json',
  'application/xml',
  'application/xhtml+xml',
  'application/x-www-form-urlencoded',
  'text/',
]

/** Parse a JSON-ish input value while preserving already-parsed values. */
function parseJsonishInput(value: unknown, fallback: unknown) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  if (typeof value !== 'string') {
    return value
  }

  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return fallback
  }

  try {
    return JSON.parse(trimmedValue)
  } catch {
    return value
  }
}

/** Convert key/value editor output or JSON objects into one plain object. */
export function normalizeApiKeyValueMap(value: unknown) {
  const parsedValue = parseJsonishInput(value, [])
  const result: Record<string, unknown> = {}

  if (Array.isArray(parsedValue)) {
    for (const rawEntry of parsedValue) {
      if (!rawEntry || typeof rawEntry !== 'object') {
        continue
      }

      const entry = rawEntry as ApiKeyValueEntry
      const key = typeof entry.key === 'string' ? entry.key.trim() : ''
      if (!key) {
        continue
      }

      result[key] = normalizeApiEntryValue(entry.value)
    }

    return result
  }

  if (parsedValue && typeof parsedValue === 'object') {
    for (const [key, entryValue] of Object.entries(parsedValue as Record<string, unknown>)) {
      if (key.trim()) {
        result[key.trim()] = normalizeApiEntryValue(entryValue)
      }
    }
  }

  return result
}

/** Collect dynamic graph inputs such as `values.image` into the parent key/value map. */
function normalizeApiPrefixedInputMap(resolvedInputs: Record<string, unknown>, prefix: string) {
  const result: Record<string, unknown> = {}

  for (const [inputKey, inputValue] of Object.entries(resolvedInputs)) {
    if (!inputKey.startsWith(prefix)) {
      continue
    }

    const entryKey = inputKey.slice(prefix.length).trim()
    if (!entryKey) {
      continue
    }

    result[entryKey] = normalizeApiEntryValue(inputValue)
  }

  return result
}

/** Coerce text values from the key/value editor into practical API body values. */
function normalizeApiEntryValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmedValue = value.trim()
  if (trimmedValue.length === 0) {
    return ''
  }

  if (trimmedValue === 'true') return true
  if (trimmedValue === 'false') return false
  if (trimmedValue === 'null') return null

  if (/^-?\d+(\.\d+)?$/.test(trimmedValue)) {
    const numericValue = Number(trimmedValue)
    if (Number.isFinite(numericValue)) {
      return numericValue
    }
  }

  if (trimmedValue.startsWith('{') || trimmedValue.startsWith('[')) {
    try {
      return JSON.parse(trimmedValue)
    } catch {
      return value
    }
  }

  return value
}

/** Normalize a supported HTTP method for the API request node. */
function normalizeApiMethod(value: unknown) {
  const method = typeof value === 'string' ? value.trim().toUpperCase() : 'POST'
  if (!API_REQUEST_METHODS.has(method)) {
    throw new Error(`API 요청 노드는 지원하지 않는 HTTP 방식이야: ${method || 'empty'}`)
  }

  return method
}

/** Normalize a required HTTP(S) URL and block non-network schemes. */
function normalizeApiUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('API 요청 노드에는 URL이 필요해')
  }

  const url = new URL(value.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API 요청 노드는 http 또는 https URL만 지원해')
  }

  return url
}

/** Normalize user-provided header values into fetch headers. */
function normalizeApiHeaders(value: unknown) {
  const headerMap = normalizeApiKeyValueMap(value)
  const headers: Record<string, string> = {}

  for (const [key, entryValue] of Object.entries(headerMap)) {
    if (entryValue === undefined || entryValue === null) {
      continue
    }

    headers[key] = typeof entryValue === 'string' ? entryValue : JSON.stringify(entryValue)
  }

  return headers
}

/** Parse data URLs into binary payloads for multipart requests and base64 helpers. */
function parseDataUrl(value: unknown): NormalizedDataUrl | null {
  if (typeof value !== 'string') {
    return null
  }

  const match = value.match(DATA_URL_PATTERN)
  if (!match) {
    return null
  }

  const mimeType = match[1] || 'application/octet-stream'
  const base64 = match[2].replace(/\s/g, '')
  if (!base64) {
    return null
  }

  return {
    mimeType,
    base64,
    buffer: Buffer.from(base64, 'base64'),
  }
}

function isLikelyFileFieldName(key: string) {
  const normalizedKey = key.trim().toLowerCase().replace(/[_-]/g, '')
  return normalizedKey === 'image'
    || normalizedKey === 'file'
    || normalizedKey === 'photo'
    || normalizedKey.endsWith('image')
    || normalizedKey.endsWith('file')
}

function inferImageMimeTypeFromBuffer(buffer: Buffer) {
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp'
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  return null
}

function parseRawBase64FileValue(key: string, value: unknown): ApiMultipartFileValue | null {
  if (!isLikelyFileFieldName(key) || typeof value !== 'string') {
    return null
  }

  const base64 = value.trim().replace(/\s/g, '')
  if (base64.length < 16 || base64.length % 4 !== 0 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(base64)) {
    return null
  }

  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.length || buffer.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) {
    return null
  }

  const mimeType = inferImageMimeTypeFromBuffer(buffer)
  if (!mimeType) {
    return null
  }

  return { mimeType, base64, buffer }
}

function parseMultipartFileValue(key: string, value: unknown): ApiMultipartFileValue | null {
  const dataUrl = parseDataUrl(value)
  if (dataUrl) {
    return dataUrl
  }

  return parseRawBase64FileValue(key, value)
}

/** Resolve a stable file extension for common data URL MIME types. */
function getObjectStringValue(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const entryValue = value[key]
    if (typeof entryValue === 'string' && entryValue.trim().length > 0) {
      return entryValue.trim()
    }
  }

  return null
}

function inferMimeTypeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.bmp') return 'image/bmp'
  if (extension === '.avif') return 'image/avif'
  if (extension === '.mp4') return 'video/mp4'
  if (extension === '.webm') return 'video/webm'
  if (extension === '.mov') return 'video/quicktime'
  return 'application/octet-stream'
}

function normalizeUploadsRelativePath(value: string) {
  return value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^uploads\//i, '')
}

function isUploadsPublicPath(value: string) {
  const normalizedPath = normalizeUploadsRelativePath(value)
  return normalizedPath.startsWith('images/')
    || normalizedPath.startsWith('API/images/')
    || normalizedPath.startsWith('videos/')
}

function resolveApiFileReferencePath(rawPath: string) {
  const trimmedPath = rawPath.trim()
  if (!trimmedPath) {
    return trimmedPath
  }

  try {
    const url = new URL(trimmedPath)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (isUploadsPublicPath(url.pathname)) {
        return resolveUploadsPath(normalizeUploadsRelativePath(url.pathname))
      }
      return trimmedPath
    }
  } catch {
    // Not a URL; resolve as a filesystem path or uploads-relative public path below.
  }

  if (isUploadsPublicPath(trimmedPath)) {
    return resolveUploadsPath(normalizeUploadsRelativePath(trimmedPath))
  }

  return path.isAbsolute(trimmedPath) ? trimmedPath : resolveUploadsPath(trimmedPath)
}

function resolveApiFileReference(value: unknown): ApiFileReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const rawPath = getObjectStringValue(record, [
    'storagePath',
    'storage_path',
    'outputPath',
    'output_path',
    'originalFilePath',
    'original_file_path',
    'imagePath',
    'image_path',
    'filePath',
    'file_path',
  ])
  if (!rawPath) {
    return null
  }

  const filePath = resolveApiFileReferencePath(rawPath)
  const mimeType = getObjectStringValue(record, ['mimeType', 'mime_type', 'outputMimeType', 'output_mime_type', 'contentType', 'content_type']) ?? inferMimeTypeFromPath(filePath)
  const fileName = getObjectStringValue(record, ['fileName', 'file_name', 'originalFileName', 'original_file_name', 'outputFileName', 'output_file_name']) ?? path.basename(filePath)
  return { filePath, mimeType, fileName }
}

async function materializeApiFileReferenceValue(value: unknown): Promise<unknown> {
  if (parseDataUrl(value)) {
    return value
  }

  const fileReference = resolveApiFileReference(value)
  if (fileReference) {
    const buffer = await fs.promises.readFile(fileReference.filePath)
    return bufferToDataUrl(buffer, fileReference.mimeType)
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((entryValue) => materializeApiFileReferenceValue(entryValue)))
  }

  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, entryValue]) => [
      key,
      await materializeApiFileReferenceValue(entryValue),
    ] as const))
    return Object.fromEntries(entries)
  }

  return value
}

function getExtensionForMimeType(mimeType: string) {
  const normalizedMimeType = mimeType.toLowerCase()
  if (normalizedMimeType === 'image/jpeg') return 'jpg'
  if (normalizedMimeType === 'image/png') return 'png'
  if (normalizedMimeType === 'image/webp') return 'webp'
  if (normalizedMimeType === 'image/gif') return 'gif'
  if (normalizedMimeType === 'video/mp4') return 'mp4'
  if (normalizedMimeType === 'video/webm') return 'webm'
  if (normalizedMimeType === 'application/json') return 'json'
  if (normalizedMimeType.startsWith('text/')) return 'txt'
  return 'bin'
}

/** Check whether any top-level value needs multipart/form-data transport. */
function hasMultipartValue(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return Object.entries(value as Record<string, unknown>).some(([key, entryValue]) => Boolean(parseMultipartFileValue(key, entryValue)))
}

function buildBlobPartFromBuffer(buffer: Buffer) {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(arrayBuffer).set(buffer)
  return arrayBuffer
}

/** Build a Blob-backed multipart body from top-level API body entries. */
function buildMultipartBody(value: Record<string, unknown>) {
  const formData = new FormData()

  for (const [key, entryValue] of Object.entries(value)) {
    const fileValue = parseMultipartFileValue(key, entryValue)
    if (fileValue) {
      const extension = getExtensionForMimeType(fileValue.mimeType)
      const blob = new Blob([buildBlobPartFromBuffer(fileValue.buffer)], { type: fileValue.mimeType })
      formData.append(key, blob, fileValue.fileName ?? `${key}.${extension}`)
      continue
    }

    if (entryValue === undefined || entryValue === null) {
      continue
    }

    formData.append(key, typeof entryValue === 'string' ? entryValue : JSON.stringify(entryValue))
  }

  return formData
}

/** Merge key/value entries and upstream payload into one request body value. */
function buildApiBodyValue(entries: Record<string, unknown>, payload: unknown) {
  const hasEntries = Object.keys(entries).length > 0
  if (payload === undefined || payload === null || payload === '') {
    return hasEntries ? entries : undefined
  }

  const parsedPayload = parseJsonishInput(payload, payload)
  if (!hasEntries) {
    return parsedPayload
  }

  if (parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload) && !parseDataUrl(parsedPayload)) {
    return {
      ...entries,
      ...(parsedPayload as Record<string, unknown>),
    }
  }

  return {
    ...entries,
    payload: parsedPayload,
  }
}

/** Append query values to URL for GET requests. */
function applyQueryParams(url: URL, queryValue: Record<string, unknown>) {
  for (const [key, entryValue] of Object.entries(queryValue)) {
    if (entryValue === undefined || entryValue === null) {
      continue
    }

    url.searchParams.set(key, typeof entryValue === 'string' ? entryValue : JSON.stringify(entryValue))
  }
}

/** Build fetch body and headers from method, body mode, and normalized body value. */
function buildApiRequestPayload(params: {
  method: string
  bodyMode: string
  bodyValue: unknown
  headers: Record<string, string>
}) {
  const { method, bodyMode, bodyValue } = params
  const headers = { ...params.headers }

  if (method === 'GET' || bodyValue === undefined) {
    return { headers, body: undefined }
  }

  const normalizedBodyValue = bodyValue && typeof bodyValue === 'object' && !Array.isArray(bodyValue)
    ? bodyValue as Record<string, unknown>
    : { payload: bodyValue }
  const containsMultipartValue = hasMultipartValue(normalizedBodyValue)
  const shouldUseMultipart = bodyMode === 'form' || containsMultipartValue

  if (shouldUseMultipart) {
    for (const headerName of Object.keys(headers)) {
      if (headerName.toLowerCase() === 'content-type') {
        delete headers[headerName]
      }
    }

    return { headers, body: buildMultipartBody(normalizedBodyValue) }
  }

  if (!Object.keys(headers).some((headerName) => headerName.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json'
  }

  return { headers, body: JSON.stringify(bodyValue) }
}

/** Convert one fetch response into the graph node's single response value. */
async function parseApiResponse(response: Response) {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  const shouldReadText = TEXT_RESPONSE_CONTENT_TYPES.some((candidate) => (
    candidate.endsWith('/') ? contentType.startsWith(candidate) : contentType === candidate || contentType.endsWith('+json')
  ))

  if (shouldReadText) {
    const text = await response.text()
    if (contentType.includes('json')) {
      return text.trim() ? JSON.parse(text) : null
    }

    return text
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return bufferToDataUrl(buffer, contentType || 'application/octet-stream')
}

/** Execute a generic HTTP API request node and expose the received value. */
export async function executeApiRequestNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const url = normalizeApiUrl(resolvedInputs.url)
  const method = normalizeApiMethod(resolvedInputs.method)
  const bodyMode = typeof resolvedInputs.body_mode === 'string' ? resolvedInputs.body_mode : 'auto'
  const timeoutMs = Math.max(1000, Math.min(300_000, Number(resolvedInputs.timeout_ms) || 30_000))
  const entries = {
    ...normalizeApiKeyValueMap(resolvedInputs.values),
    ...normalizeApiPrefixedInputMap(resolvedInputs, API_VALUES_FIELD_PREFIX),
  }
  const headers = normalizeApiHeaders({
    ...normalizeApiKeyValueMap(resolvedInputs.headers),
    ...normalizeApiPrefixedInputMap(resolvedInputs, API_HEADERS_FIELD_PREFIX),
  })
  const bodyValue = await materializeApiFileReferenceValue(buildApiBodyValue(entries, resolvedInputs.payload))

  if (method === 'GET' && bodyValue !== undefined) {
    const queryValue = bodyValue && typeof bodyValue === 'object' && !Array.isArray(bodyValue)
      ? bodyValue as Record<string, unknown>
      : { payload: bodyValue }
    applyQueryParams(url, queryValue)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const requestPayload = buildApiRequestPayload({
    method,
    bodyMode: bodyMode === 'json' || bodyMode === 'form' ? bodyMode : 'auto',
    bodyValue,
    headers,
  })

  try {
    const response = await fetch(url, {
      method,
      headers: requestPayload.headers,
      body: requestPayload.body,
      signal: controller.signal,
    })
    const responseValue = await parseApiResponse(response)

    if (!response.ok) {
      const preview = typeof responseValue === 'string'
        ? responseValue.slice(0, 400)
        : JSON.stringify(responseValue).slice(0, 400)
      throw new Error(`API 요청 실패: HTTP ${response.status} ${response.statusText}${preview ? ` - ${preview}` : ''}`)
    }

    completeSystemNode(context, node, moduleDefinition, 'system.api_request', {
      response: buildRuntimeArtifact(context.executionId, node.id, 'response', 'any', responseValue, {
        kind: 'system-api-response',
        operationKey: 'system.api_request',
        status: response.status,
        contentType: response.headers.get('content-type') ?? undefined,
      }),
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Convert text, JSON, or data URL values into base64 text. */
export async function executeBase64EncodeNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const inputMode = typeof resolvedInputs.input_mode === 'string' ? resolvedInputs.input_mode : 'auto'
  const value = await materializeApiFileReferenceValue(resolvedInputs.value)
  const dataUrl = inputMode === 'data_url' || inputMode === 'auto' ? parseDataUrl(value) : null
  const base64 = dataUrl
    ? dataUrl.base64
    : Buffer.from(inputMode === 'json' ? JSON.stringify(parseJsonishInput(value, value)) : String(value ?? ''), 'utf8').toString('base64')

  completeSystemNode(context, node, moduleDefinition, 'system.base64_encode', {
    base64: buildRuntimeArtifact(context.executionId, node.id, 'base64', 'text', base64, {
      kind: 'system-base64-encode',
      operationKey: 'system.base64_encode',
      mimeType: dataUrl?.mimeType,
    }),
  })
}

/** Decode base64 into text, JSON, or data URL output. */
export function executeBase64DecodeNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const outputMode = typeof resolvedInputs.output_mode === 'string' ? resolvedInputs.output_mode : 'data_url'
  const mimeType = typeof resolvedInputs.mime_type === 'string' && resolvedInputs.mime_type.trim()
    ? resolvedInputs.mime_type.trim()
    : 'application/octet-stream'
  const parsedDataUrl = parseDataUrl(resolvedInputs.base64)
  const base64 = parsedDataUrl?.base64 ?? String(resolvedInputs.base64 ?? '').replace(/\s/g, '')
  const buffer = Buffer.from(base64, 'base64')
  const value = outputMode === 'text'
    ? buffer.toString('utf8')
    : outputMode === 'json'
      ? JSON.parse(buffer.toString('utf8'))
      : bufferToDataUrl(buffer, parsedDataUrl?.mimeType ?? mimeType)

  completeSystemNode(context, node, moduleDefinition, 'system.base64_decode', {
    value: buildRuntimeArtifact(context.executionId, node.id, 'value', 'any', value, {
      kind: 'system-base64-decode',
      operationKey: 'system.base64_decode',
      outputMode,
      mimeType: parsedDataUrl?.mimeType ?? mimeType,
    }),
  })
}
