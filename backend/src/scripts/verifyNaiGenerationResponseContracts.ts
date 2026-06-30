import assert from 'node:assert/strict'
// @ts-ignore - no types available
import AdmZip from 'adm-zip'
import { decodeNaiImageResponse } from '../services/naiGenerationExecutor'

const pngBytes = Buffer.from('sample-png-bytes')

const jsonResponse = Buffer.from(JSON.stringify({
  images: [
    { image: pngBytes.toString('base64') },
    { image: `data:image/png;base64,${pngBytes.toString('base64')}` },
  ],
}))

const jsonImages = decodeNaiImageResponse(jsonResponse, 'application/json')
assert.equal(jsonImages.length, 2, 'NovelAI JSON image responses should decode every image entry')
assert.deepEqual(jsonImages[0], pngBytes, 'plain base64 JSON images should decode to buffers')
assert.deepEqual(jsonImages[1], pngBytes, 'data URL JSON images should decode to buffers')

const zip = new AdmZip()
zip.addFile('image.png', pngBytes)
const zipImages = decodeNaiImageResponse(zip.toBuffer(), 'application/zip')
assert.equal(zipImages.length, 1, 'Legacy NovelAI zip responses should still decode image entries')
assert.deepEqual(zipImages[0], pngBytes, 'zip image entries should decode to buffers')

assert.throws(
  () => decodeNaiImageResponse(Buffer.from('not an image response'), 'text/plain'),
  /unsupported image response/,
  'Unsupported NovelAI responses should fail with a diagnostic message',
)

console.log('✅ NAI generation response contracts verified')
