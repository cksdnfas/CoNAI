import assert from 'node:assert/strict'
import path from 'node:path'
import { resolveChildPathWithinDirectory } from '../routes/imageEditorRouteHelpers'

function normalize(filePath: string | null) {
  return filePath ? filePath.replace(/\\/g, '/') : filePath
}

function verifyChildPathResolution() {
  const baseDir = path.resolve('/tmp/conai-canvas')

  assert.equal(
    normalize(resolveChildPathWithinDirectory(baseDir, 'image.webp')),
    normalize(path.join(baseDir, 'image.webp')),
  )
  assert.equal(
    normalize(resolveChildPathWithinDirectory(baseDir, 'nested/image.webp')),
    normalize(path.join(baseDir, 'nested/image.webp')),
  )
  assert.equal(resolveChildPathWithinDirectory(baseDir, ''), null)
  assert.equal(resolveChildPathWithinDirectory(baseDir, '..'), null)
  assert.equal(resolveChildPathWithinDirectory(baseDir, '../secret.webp'), null)
  assert.equal(resolveChildPathWithinDirectory(baseDir, '../conai-canvas-evil/secret.webp'), null)
  assert.equal(resolveChildPathWithinDirectory(baseDir, '/tmp/conai-canvas-evil/secret.webp'), null)
}

verifyChildPathResolution()

console.log('✅ Image editor route contracts verified')
