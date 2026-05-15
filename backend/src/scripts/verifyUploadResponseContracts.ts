import { buildUploadResponseData } from '../routes/images/uploadResponseHelpers'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertCompositeHashIsExposed() {
  const result = buildUploadResponseData({
    file: { originalname: 'source.png' },
    processedData: {
      filename: 'source-processed.webp',
      width: 512,
      height: 768,
      fileSize: 123456,
    },
    mediaProcessing: {
      fileId: 42,
      compositeHash: 'abc123:def456',
    },
    mimeType: 'image/webp',
    uploadDate: '2026-05-15T10:00:00.000Z',
  })

  assertEqual(result.id, 42, 'upload response should expose processed file id')
  assertEqual(result.composite_hash, 'abc123:def456', 'upload response should expose detail-route composite hash')
  assertEqual(result.original_name, 'source.png', 'upload response should preserve source file name')
  assertEqual(result.filename, 'source-processed.webp', 'upload response should expose saved file name')
}

function assertMissingCompositeHashStaysNull() {
  const result = buildUploadResponseData({
    file: { originalname: 'movie.mp4' },
    processedData: {
      filename: 'movie.mp4',
      width: null,
      height: null,
      fileSize: 999,
    },
    mediaProcessing: {
      fileId: 7,
      compositeHash: null,
    },
    mimeType: 'video/mp4',
    uploadDate: '2026-05-15T10:00:00.000Z',
  })

  assertEqual(result.composite_hash, null, 'upload response should keep unavailable hashes explicit')
}

assertCompositeHashIsExposed()
assertMissingCompositeHashStaysNull()

console.log('Upload response contracts verified.')
