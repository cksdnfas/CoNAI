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
  onUpstreamAccepted?: () => void | Promise<void>
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

  const response = await axios.post('https://image.novelai.net/ai/generate-image', requestBody, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://novelai.net',
      Referer: 'https://novelai.net',
    },
    responseType: 'arraybuffer',
    timeout: 120000,
  })

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
