import axios from 'axios'
// @ts-ignore - no types available
import AdmZip from 'adm-zip'
import { preprocessMetadata, type NAIMetadataInputParams, type NAIMetadataParams } from '../utils/nai/metadata'
import { buildNaiRequestBody } from '../utils/nai/requestBuilder'

type NaiJsonImage = {
  image?: unknown
}

type NaiJsonResponse = {
  images?: unknown
}

export interface ExecuteNaiGenerationResult {
  metadata: NAIMetadataParams
  requestBody: Awaited<ReturnType<typeof buildNaiRequestBody>>
  imageBuffers: Buffer[]
}

export interface ExecuteNaiGenerationOptions {
  /** PJ-1: 요청 전송 직전에 "제출 의사"를 커밋한다(GEN-2가 만든 post 앞 지점을 계승). */
  onUpstreamSubmitting?: () => void | Promise<void>
  /** 응답 수신 뒤의 확정 지점. 여기서부터는 상류 작업이 확실히 존재한다. */
  onUpstreamAccepted?: () => void | Promise<void>
  signal?: AbortSignal
}

function isZipBuffer(buffer: Buffer) {
  return buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
}

function isJsonResponse(buffer: Buffer, contentType?: string) {
  if (contentType?.toLowerCase().includes('json')) {
    return true
  }

  const firstNonWhitespace = buffer.toString('utf8', 0, Math.min(buffer.length, 64)).trimStart()[0]
  return firstNonWhitespace === '{' || firstNonWhitespace === '['
}

function normalizeBase64Payload(value: string) {
  const match = value.match(/^data:[^;]+;base64,(.*)$/)
  return (match?.[1] ?? value).trim()
}

function parseNaiJsonImages(buffer: Buffer) {
  const parsed = JSON.parse(buffer.toString('utf8')) as NaiJsonResponse
  const images = Array.isArray(parsed.images) ? parsed.images : []
  const imageBuffers: Buffer[] = []

  for (const entry of images) {
    const image = typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object'
        ? (entry as NaiJsonImage).image
        : null

    if (typeof image !== 'string' || !image.trim()) {
      continue
    }

    const imageBuffer = Buffer.from(normalizeBase64Payload(image), 'base64')
    if (imageBuffer.length > 0) {
      imageBuffers.push(imageBuffer)
    }
  }

  if (imageBuffers.length === 0) {
    const message = typeof (parsed as { message?: unknown }).message === 'string'
      ? (parsed as { message: string }).message
      : 'NovelAI returned JSON without image data'
    throw new Error(message)
  }

  return imageBuffers
}

function describeUnsupportedNaiResponse(buffer: Buffer, contentType?: string) {
  const preview = buffer
    .toString('utf8', 0, Math.min(buffer.length, 240))
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '.')

  return `NovelAI returned unsupported image response (${contentType || 'unknown content-type'}, ${buffer.length} bytes): ${preview}`
}

/** Decode NovelAI image responses. Supports current JSON/base64 and legacy zip payloads. */
export function decodeNaiImageResponse(data: ArrayBuffer | Buffer, contentType?: string) {
  const buffer = Buffer.isBuffer(data)
    ? data
    : Buffer.from(new Uint8Array(data))

  if (isJsonResponse(buffer, contentType)) {
    return parseNaiJsonImages(buffer)
  }

  if (isZipBuffer(buffer)) {
    const zip = new AdmZip(buffer)
    return zip.getEntries().map((entry: any) => entry.getData())
  }

  throw new Error(describeUnsupportedNaiResponse(buffer, contentType))
}

/** Execute one NovelAI image-generation request and decode all returned images. */
export async function executeNaiGeneration(
  input: NAIMetadataInputParams,
  token: string,
  options?: ExecuteNaiGenerationOptions,
): Promise<ExecuteNaiGenerationResult> {
  const metadata = preprocessMetadata(input)
  const requestBody = await buildNaiRequestBody(metadata)

  // 요청을 아직 보내지 않았으므로 여기서 끊기면 Anlas 소모가 없는 깨끗한 취소다.
  if (options?.signal?.aborted) {
    throw new Error('NovelAI generation was cancelled before the upstream request was sent')
  }

  // Mark the job as running before the upstream call so started_at reflects the real runtime.
  await options?.onUpstreamSubmitting?.()

  const response = await axios.post('https://image.novelai.net/ai/generate-image', requestBody, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://novelai.net',
      Referer: 'https://novelai.net',
    },
    responseType: 'arraybuffer',
    timeout: 120000,
    signal: options?.signal,
  })

  // 응답을 받은 시점부터는 상류 작업이 확실히 존재한다.
  await options?.onUpstreamAccepted?.()

  const contentTypeHeader = response.headers['content-type']
  const imageBuffers = decodeNaiImageResponse(
    response.data,
    typeof contentTypeHeader === 'string' ? contentTypeHeader : undefined,
  )

  return {
    metadata,
    requestBody,
    imageBuffers,
  }
}
