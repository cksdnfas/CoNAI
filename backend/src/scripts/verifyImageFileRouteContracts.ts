import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { once } from 'node:events'
import type { Request, Response } from 'express'
import {
  getCompositeHashOrBlock,
  getMimeTypeFromFilePath,
  streamCacheableFile,
  streamRangeFile,
} from '../routes/images/query-file-response-helpers'

class CapturedResponse extends Writable {
  statusCode: number | undefined
  payload: unknown
  headers = new Map<string, number | string | readonly string[]>()
  chunks: Buffer[] = []

  status(code: number) {
    this.statusCode = code
    return this
  }

  setHeader(name: string, value: number | string | readonly string[]) {
    this.headers.set(name.toLowerCase(), value)
    return this
  }

  getHeader(name: string) {
    return this.headers.get(name.toLowerCase())
  }

  json(payload: unknown) {
    this.payload = payload
    this.end()
    return this
  }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    callback()
  }

  bodyText() {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

function createResponse() {
  return new CapturedResponse() as unknown as Response & CapturedResponse
}

function createRequest(headers: Record<string, string | string[] | undefined> = {}) {
  return { headers, params: {} } as Request
}

async function waitForFinish(response: CapturedResponse) {
  if (response.writableFinished) {
    return
  }

  await once(response, 'finish')
}

function verifyCompositeHashValidation() {
  const validHash = 'a'.repeat(48)
  const validResponse = createResponse()
  assert.equal(getCompositeHashOrBlock({ params: { compositeHash: validHash } } as unknown as Request, validResponse), validHash)
  assert.equal(validResponse.statusCode, undefined)

  const shortResponse = createResponse()
  assert.equal(getCompositeHashOrBlock({ params: { compositeHash: 'abc' } } as unknown as Request, shortResponse), null)
  assert.equal(shortResponse.statusCode, 400)
  assert.deepEqual(shortResponse.payload, {
    success: false,
    error: 'Invalid composite hash',
  })
}

async function verifyCacheableFileStreaming(filePath: string) {
  const firstResponse = createResponse()
  await streamCacheableFile(createRequest(), firstResponse, filePath, 'text/plain')
  await waitForFinish(firstResponse)

  assert.equal(firstResponse.statusCode, undefined)
  assert.equal(firstResponse.getHeader('content-type'), 'text/plain')
  assert.equal(firstResponse.getHeader('content-length'), 10)
  assert.equal(firstResponse.bodyText(), '0123456789')

  const etag = firstResponse.getHeader('etag')
  assert.equal(typeof etag, 'string')

  const cachedResponse = createResponse()
  await streamCacheableFile(createRequest({ 'if-none-match': etag as string }), cachedResponse, filePath, 'text/plain')
  await waitForFinish(cachedResponse)

  assert.equal(cachedResponse.statusCode, 304)
  assert.equal(cachedResponse.bodyText(), '')
}

async function verifyRangeStreaming(filePath: string) {
  const rangeResponse = createResponse()
  streamRangeFile(createRequest({ range: 'bytes=2-5' }), rangeResponse, filePath, 'text/plain')
  await waitForFinish(rangeResponse)

  assert.equal(rangeResponse.statusCode, 206)
  assert.equal(rangeResponse.getHeader('content-range'), 'bytes 2-5/10')
  assert.equal(rangeResponse.getHeader('content-length'), 4)
  assert.equal(rangeResponse.bodyText(), '2345')

  const suffixResponse = createResponse()
  streamRangeFile(createRequest({ range: 'bytes=-3' }), suffixResponse, filePath, 'text/plain')
  await waitForFinish(suffixResponse)

  assert.equal(suffixResponse.statusCode, 206)
  assert.equal(suffixResponse.getHeader('content-range'), 'bytes 7-9/10')
  assert.equal(suffixResponse.bodyText(), '789')

  const invalidResponse = createResponse()
  streamRangeFile(createRequest({ range: 'bytes=20-30' }), invalidResponse, filePath, 'text/plain')
  await waitForFinish(invalidResponse)

  assert.equal(invalidResponse.statusCode, 416)
  assert.equal(invalidResponse.getHeader('content-range'), 'bytes */10')
  assert.equal(invalidResponse.bodyText(), '')

  const firstResponse = createResponse()
  streamRangeFile(createRequest(), firstResponse, filePath, 'text/plain')
  await waitForFinish(firstResponse)

  assert.equal(firstResponse.statusCode, 200)
  assert.equal(firstResponse.getHeader('content-length'), 10)
  assert.equal(firstResponse.bodyText(), '0123456789')
}

function verifyMimeTypeResolution() {
  assert.equal(getMimeTypeFromFilePath('sample.JPG'), 'image/jpeg')
  assert.equal(getMimeTypeFromFilePath('sample.webp'), 'image/webp')
  assert.equal(getMimeTypeFromFilePath('sample.mp4'), 'video/mp4')
  assert.equal(getMimeTypeFromFilePath('sample.unknown'), 'application/octet-stream')
}

async function main() {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'conai-image-file-route-'))
  const filePath = path.join(tempDir, 'sample.png')

  try {
    await fs.promises.writeFile(filePath, '0123456789')
    verifyCompositeHashValidation()
    verifyMimeTypeResolution()
    await verifyCacheableFileStreaming(filePath)
    await verifyRangeStreaming(filePath)
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

main()
  .then(() => {
    console.log('✅ Image file route contracts verified')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
