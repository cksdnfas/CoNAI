import assert from 'node:assert/strict'
import { resolveComfyGraphOutputDescriptor, resolveComfyOutputMimeType } from '../services/graph-workflow-executor/comfyArtifactOutput'

function assertDescriptor(input: Parameters<typeof resolveComfyGraphOutputDescriptor>[0], expected: ReturnType<typeof resolveComfyGraphOutputDescriptor>) {
  assert.deepEqual(resolveComfyGraphOutputDescriptor(input), expected)
}

assert.equal(
  resolveComfyOutputMimeType({ format: 'video/mp4', filename: 'preview.mp4', tempPath: 'C:/tmp/preview.mp4' }),
  'video/mp4',
)
assert.equal(
  resolveComfyOutputMimeType({ format: 'png', filename: 'preview.png', tempPath: 'C:/tmp/preview.png' }),
  'image/png',
)

assertDescriptor(
  { mimeType: 'image/png', filePath: 'C:/tmp/image.png', fileName: 'image.png', explicitKind: 'image' },
  { artifactType: 'image', outputKind: 'image', mimeType: 'image/png' },
)
assertDescriptor(
  { mimeType: 'image/webp', filePath: 'C:/tmp/animated.webp', fileName: 'animated.webp', explicitKind: 'animated' },
  { artifactType: 'image', outputKind: 'animated', mimeType: 'image/webp' },
)
assertDescriptor(
  { mimeType: 'video/webm', filePath: 'C:/tmp/movie.webm', fileName: 'movie.webm' },
  { artifactType: 'file', outputKind: 'video', mimeType: 'video/webm' },
)
assertDescriptor(
  { mimeType: 'application/octet-stream', filePath: 'C:/tmp/archive.zip', fileName: 'archive.zip' },
  { artifactType: 'file', outputKind: 'file', mimeType: 'application/octet-stream' },
)
assertDescriptor(
  { mimeType: '', filePath: 'C:/tmp/output.gif', fileName: 'output.gif' },
  { artifactType: 'image', outputKind: 'animated', mimeType: 'image/png' },
)

console.log('Graph Comfy artifact descriptor verification passed')
