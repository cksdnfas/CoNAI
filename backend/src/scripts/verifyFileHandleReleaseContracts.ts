import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { PassThrough } from 'node:stream'
import type { Response } from 'express'
import sharp from 'sharp'
import { configureSharpRuntime } from '../config/sharpRuntime'
import { pipeFileToResponse } from '../routes/images/query-file-response-helpers'

/**
 * 방금 생성/처리한 이미지가 삭제되지 않던 EBUSY 회귀를 막는 계약 검증.
 *
 * 두 가지 누수 경로를 다룬다.
 * 1) libvips 연산 캐시가 최근 파일 핸들을 열어 둔 채 유지하던 문제
 * 2) 클라이언트가 요청을 끊었을 때 파일 스트림이 닫히지 않던 문제
 */

function verifySharpCacheKeepsNoOpenFiles() {
  configureSharpRuntime()

  const cache = sharp.cache()
  assert.equal(cache.files.max, 0, 'sharp must not cache open file descriptors')
  assert.equal(sharp.concurrency(), 2)
}

/**
 * 캐시가 핸들을 유지하는지 실제로 드러나는 조합으로 검증한다.
 * 작은 이미지나 png/jpeg는 libvips가 파일을 열어 두지 않아 회귀를 잡지 못한다.
 * 썸네일/변환 결과 포맷인 webp를 충분히 큰 크기로 쓰면 기본 캐시에서 files.current > 0 이 되고
 * Windows에서 unlink가 EBUSY로 실패한다.
 */
async function verifyProcessedImageIsUnlinkableImmediately(tempDir: string) {
  const width = 1536
  const height = 1536
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < raw.length; i += 1) {
    raw[i] = (i * 2654435761) % 251 // 압축이 무의미할 만큼 잡음이 섞인 소스
  }

  const filePath = path.join(tempDir, 'processed.webp')
  await sharp(raw, { raw: { width, height, channels: 3 } }).webp({ quality: 90 }).toFile(filePath)

  // 경로 입력으로 여러 번 읽어 캐시가 핸들을 붙잡을 기회를 준다.
  await sharp(filePath).metadata()
  await sharp(filePath).resize(32, 32).greyscale().raw().toBuffer()

  assert.equal(sharp.cache().files.current, 0, 'libvips must not hold open descriptors after a pipeline')

  // 캐시가 핸들을 유지하면 여기서 EBUSY: resource busy or locked, unlink 가 난다.
  await fs.promises.unlink(filePath)
  assert.equal(fs.existsSync(filePath), false)
}

function createFakeResponse() {
  const res = new PassThrough()
  res.on('error', () => {})
  Object.assign(res, { headersSent: false, status: () => res, destroy: PassThrough.prototype.destroy.bind(res) })
  return res
}

async function verifyAbortedDownloadReleasesFileHandle(tempDir: string) {
  const filePath = path.join(tempDir, 'aborted-download.bin')
  await fs.promises.writeFile(filePath, Buffer.alloc(4 * 1024 * 1024, 7))

  const res = createFakeResponse()
  const stream = fs.createReadStream(filePath)

  let closedCallbackCount = 0
  const streamClosed = new Promise<void>((resolve) => {
    pipeFileToResponse(res as unknown as Response, stream, () => {
      closedCallbackCount += 1
      resolve()
    })
  })

  // 브라우저가 이미지 요청을 취소한 상황 재현.
  res.destroy()

  await streamClosed
  assert.equal(stream.destroyed, true, 'read stream must be destroyed when the response closes')
  assert.equal(closedCallbackCount, 1)

  await fs.promises.unlink(filePath)
  assert.equal(fs.existsSync(filePath), false)
}

async function verifyCompletedDownloadRunsCleanupOnce(tempDir: string) {
  const filePath = path.join(tempDir, 'completed-download.bin')
  await fs.promises.writeFile(filePath, 'payload')

  const res = createFakeResponse()
  res.resume()
  const stream = fs.createReadStream(filePath)

  let closedCallbackCount = 0
  const streamClosed = new Promise<void>((resolve) => {
    pipeFileToResponse(res as unknown as Response, stream, () => {
      closedCallbackCount += 1
      resolve()
    })
  })

  await streamClosed
  assert.equal(closedCallbackCount, 1, 'cleanup callback must run exactly once on completion')

  await fs.promises.unlink(filePath)
}

async function main() {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'conai-file-handle-release-'))

  try {
    verifySharpCacheKeepsNoOpenFiles()
    await verifyProcessedImageIsUnlinkableImmediately(tempDir)
    await verifyAbortedDownloadReleasesFileHandle(tempDir)
    await verifyCompletedDownloadRunsCleanupOnce(tempDir)
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }

  console.log('✅ File handle release contracts passed')
}

main()
