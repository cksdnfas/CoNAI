import assert from 'node:assert/strict'
import { resolveFinalResultPromotionCandidate } from '../services/graph-workflow-executor/final-result-promotion'
import type { RuntimeArtifact } from '../services/graph-workflow-executor/shared'

function artifact(overrides: Partial<RuntimeArtifact>): RuntimeArtifact {
  return {
    type: 'image',
    value: {},
    storagePath: 'C:/tmp/final.png',
    artifactRecordId: 1,
    metadata: {},
    ...overrides,
  }
}

const naiFinal = resolveFinalResultPromotionCandidate(artifact({
  metadata: {
    kind: 'nai-image',
    graph_result_service_type: 'novelai',
    mimeType: 'image/png',
    model: 'nai-diffusion-4-5-curated',
  },
}))
assert.equal(naiFinal.shouldPromote, true)
assert.equal(naiFinal.serviceType, 'novelai')
assert.equal(naiFinal.mimeType, 'image/png')
assert.equal(naiFinal.reason, null)

const alreadyUploadedCodex = resolveFinalResultPromotionCandidate(artifact({
  metadata: {
    kind: 'codex-queue-image',
    compositeHash: 'hash:existing',
    mimeType: 'image/png',
  },
}))
assert.equal(alreadyUploadedCodex.shouldPromote, false)
assert.equal(alreadyUploadedCodex.serviceType, 'codex')
assert.equal(alreadyUploadedCodex.compositeHash, 'hash:existing')
assert.equal(alreadyUploadedCodex.reason, 'already_uploaded')

const actualHashUploaded = resolveFinalResultPromotionCandidate(artifact({
  metadata: {
    kind: 'codex-queue-image',
    actual_composite_hash: 'hash:actual',
    mimeType: 'image/png',
  },
}))
assert.equal(actualHashUploaded.shouldPromote, false)
assert.equal(actualHashUploaded.compositeHash, 'hash:actual')
assert.equal(actualHashUploaded.reason, 'already_uploaded')

const nonVisual = resolveFinalResultPromotionCandidate(artifact({
  type: 'json',
  value: { ok: true },
  storagePath: 'C:/tmp/data.json',
  metadata: { mimeType: 'application/json' },
}))
assert.equal(nonVisual.shouldPromote, false)
assert.equal(nonVisual.reason, 'not_visual_media')

const videoFinal = resolveFinalResultPromotionCandidate(artifact({
  type: 'file',
  storagePath: 'C:/tmp/final.webm',
  metadata: { mimeType: 'video/webm' },
}))
assert.equal(videoFinal.shouldPromote, true)
assert.equal(videoFinal.serviceType, 'comfyui')
assert.equal(videoFinal.mimeType, 'video/webm')

const valueBackedFinal = resolveFinalResultPromotionCandidate(artifact({
  type: 'file',
  storagePath: undefined,
  metadata: {},
  value: {
    kind: 'codex-queue-image',
    storagePath: 'C:/tmp/value-backed.webp',
    mimeType: 'image/webp',
    originalFileName: 'value-backed.webp',
    width: '768',
    height: '512',
  },
}))
assert.equal(valueBackedFinal.shouldPromote, true)
assert.equal(valueBackedFinal.serviceType, 'codex')
assert.equal(valueBackedFinal.mimeType, 'image/webp')
assert.equal(valueBackedFinal.storagePath, 'C:/tmp/value-backed.webp')
assert.equal(valueBackedFinal.originalFileName, 'value-backed.webp')

const metadataAliasFinal = resolveFinalResultPromotionCandidate(artifact({
  type: 'file',
  storagePath: undefined,
  metadata: {
    kind: 'codex-queue-image',
    storage_path: 'C:/tmp/metadata-backed.png',
    output_mime_type: 'image/png',
    output_file_name: 'metadata-backed.png',
  },
  value: {},
}))
assert.equal(metadataAliasFinal.shouldPromote, true)
assert.equal(metadataAliasFinal.serviceType, 'codex')
assert.equal(metadataAliasFinal.mimeType, 'image/png')
assert.equal(metadataAliasFinal.storagePath, 'C:/tmp/metadata-backed.png')
assert.equal(metadataAliasFinal.originalFileName, 'metadata-backed.png')

const metadataCamelCaseAliasFinal = resolveFinalResultPromotionCandidate(artifact({
  type: 'file',
  storagePath: undefined,
  metadata: {
    kind: 'codex-queue-image',
    outputPath: 'C:/tmp/metadata-camel-backed.webp',
    outputMimeType: 'image/webp',
    outputFileName: 'metadata-camel-backed.webp',
  },
  value: {},
}))
assert.equal(metadataCamelCaseAliasFinal.shouldPromote, true)
assert.equal(metadataCamelCaseAliasFinal.serviceType, 'codex')
assert.equal(metadataCamelCaseAliasFinal.mimeType, 'image/webp')
assert.equal(metadataCamelCaseAliasFinal.storagePath, 'C:/tmp/metadata-camel-backed.webp')
assert.equal(metadataCamelCaseAliasFinal.originalFileName, 'metadata-camel-backed.webp')

const uploadedAliasFinal = resolveFinalResultPromotionCandidate(artifact({
  type: 'file',
  storagePath: undefined,
  metadata: {
    actualCompositeHash: 'hash:actual-alias',
    original_file_path: 'C:/tmp/source-alias.webp',
    output_mime_type: 'image/webp',
    file_name: 'source-alias.webp',
  },
  value: {},
}))
assert.equal(uploadedAliasFinal.shouldPromote, false)
assert.equal(uploadedAliasFinal.compositeHash, 'hash:actual-alias')
assert.equal(uploadedAliasFinal.mimeType, 'image/webp')
assert.equal(uploadedAliasFinal.storagePath, 'C:/tmp/source-alias.webp')
assert.equal(uploadedAliasFinal.originalFileName, 'source-alias.webp')

console.log('✅ Graph final-result promotion contracts verified (NAI promote, uploaded dedupe, non-visual skip, video promote, value/metadata alias fallback)')
