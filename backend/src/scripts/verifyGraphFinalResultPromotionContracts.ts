import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveFinalResultPromotionCandidate, tryPromoteFinalResultArtifactToGenerationHistory } from '../services/graph-workflow-executor/final-result-promotion'
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

const generationMetadataFinal = resolveFinalResultPromotionCandidate(artifact({
  type: 'file',
  storagePath: undefined,
  metadata: {
    kind: 'nai-image',
    output_path: 'C:/tmp/metadata-parameters.png',
    output_mime_type: 'image/png',
    seed: '4242',
    steps: '31',
    scale: '6.5',
    sampler_name: 'k_euler_ancestral',
    noise_schedule: 'karras',
  },
  value: {},
}))
assert.equal(generationMetadataFinal.shouldPromote, true)
assert.equal(generationMetadataFinal.seed, 4242)
assert.equal(generationMetadataFinal.steps, 31)
assert.equal(generationMetadataFinal.cfgScale, 6.5)
assert.equal(generationMetadataFinal.sampler, 'k_euler_ancestral')
assert.equal(generationMetadataFinal.scheduler, 'karras')

const generationCamelCaseMetadataFinal = resolveFinalResultPromotionCandidate(artifact({
  type: 'file',
  storagePath: undefined,
  metadata: {
    kind: 'nai-image',
    output_path: 'C:/tmp/metadata-camel-parameters.png',
    output_mime_type: 'image/png',
    noiseSeed: '5252',
    samplingSteps: '28',
    guidanceScale: '7.25',
    samplerName: 'dpmpp_2m',
    schedulerName: 'exponential',
  },
  value: {},
}))
assert.equal(generationCamelCaseMetadataFinal.shouldPromote, true)
assert.equal(generationCamelCaseMetadataFinal.seed, 5252)
assert.equal(generationCamelCaseMetadataFinal.steps, 28)
assert.equal(generationCamelCaseMetadataFinal.cfgScale, 7.25)
assert.equal(generationCamelCaseMetadataFinal.sampler, 'dpmpp_2m')
assert.equal(generationCamelCaseMetadataFinal.scheduler, 'exponential')

const generationDimensionAliasFinal = resolveFinalResultPromotionCandidate(artifact({
  type: 'file',
  storagePath: undefined,
  metadata: {
    kind: 'nai-image',
    output_path: 'C:/tmp/metadata-dimensions.png',
    output_mime_type: 'image/png',
    actualWidth: '1536',
    actual_height: '1024',
  },
  value: {},
}))
assert.equal(generationDimensionAliasFinal.shouldPromote, true)
assert.equal(generationDimensionAliasFinal.width, 1536)
assert.equal(generationDimensionAliasFinal.height, 1024)

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

async function verifyPromotionFailureIsolation() {
  const result = await tryPromoteFinalResultArtifactToGenerationHistory({
    executionId: 1,
    workflowId: 1,
    workflowName: 'Missing file contract',
    finalNodeId: 'final',
    sourceNodeId: 'source',
    sourcePortKey: 'image',
    sourceArtifact: artifact({
      storagePath: 'C:/__conai_missing_final_result_promotion_contract__/missing.png',
      metadata: { mimeType: 'image/png' },
    }),
  })

  assert.equal(result.shouldPromote, false)
  assert.equal(result.reason, 'promotion_failed')
  assert.equal('errorMessage' in result, true)
  if ('errorMessage' in result) {
    assert.match(result.errorMessage, /ENOENT|no such file|cannot find/i)
  }
}

function verifyMissingSourceArtifactWarningContract() {
  const source = readFileSync(resolve(process.cwd(), 'src/services/graph-workflow-executor/system-result-operations.ts'), 'utf8')

  assert.match(
    source,
    /skippedReason: 'source_artifact_not_persisted'[\s\S]*?eventType: 'final_result_source_artifact_missing'/,
    'final-result nodes with non-persisted source outputs should emit a dedicated warning event',
  )
  assert.match(
    source,
    /level: 'warn'[\s\S]*?eventType: 'final_result_source_artifact_missing'/,
    'missing source artifact final-result events should be warning-level logs',
  )
  assert.match(
    source,
    /eventType: 'final_result_source_artifact_missing'[\s\S]*?always: true/,
    'missing source artifact final-result warnings should persist even when verbose execution debug logs are disabled',
  )
  assert.match(
    source,
    /eventType: 'final_result_promotion_failed'[\s\S]*?always: true/,
    'promotion failure final-result warnings should persist even when verbose execution debug logs are disabled',
  )
}

function verifyArtifactOnlyHistoryListContract() {
  const modelSource = readFileSync(resolve(process.cwd(), 'src/models/GenerationHistory.ts'), 'utf8')
  const serviceSource = readFileSync(resolve(process.cwd(), 'src/services/generationHistoryService.ts'), 'utf8')
  const mcpImageToolsSource = readFileSync(resolve(process.cwd(), 'src/mcp/tools/imageTools.ts'), 'utf8')
  const workflowExecutionRoutesSource = readFileSync(resolve(process.cwd(), 'src/routes/workflows/execution.routes.ts'), 'utf8')

  assert.match(
    modelSource,
    /LEFT JOIN workflows workflow ON workflow\.id = gh\.workflow_id/,
    'generation history list reads should recognize artifact-explorer placeholder rows',
  )
  assert.match(
    modelSource,
    /AND NOT \([\s\S]*?gh\.generation_status = 'completed'[\s\S]*?gh\.composite_hash IS NULL[\s\S]*?workflow\.result_view_mode = 'artifact_explorer'[\s\S]*?\)/,
    'completed artifact-only workflow placeholders must not appear as missing image results in history lists',
  )
  assert.match(
    serviceSource,
    /GenerationHistoryModel\.countListRecords\(/,
    'generation history list totals should use the same visibility filter as history list rows',
  )
  assert.match(
    modelSource,
    /static getWorkflowListStatistics\([\s\S]*?appendHistoryListVisibilityFilter\(/,
    'workflow history stats should have a list-visible variant for artifact-explorer placeholders',
  )
  assert.match(
    mcpImageToolsSource,
    /get_generation_history[\s\S]*?GenerationHistoryModel\.findAllWithMetadata\(filters\)[\s\S]*?GenerationHistoryModel\.countListRecords\(filters\)/,
    'MCP generation-history tool should keep records and totals aligned with list visibility',
  )
  assert.match(
    mcpImageToolsSource,
    /z\.enum\(\['comfyui', 'novelai', 'codex'\]\)/,
    'MCP generation-history filter should allow every supported generation history service type',
  )
  assert.match(
    workflowExecutionRoutesSource,
    /findAllWithMetadata\(\{ workflow_id: id, limit, offset \}\)[\s\S]*?countListRecords\(\{ workflow_id: id \}\)[\s\S]*?getWorkflowListStatistics\(id\)/,
    'legacy workflow history route should align rows, pagination totals, and stats with list visibility',
  )
}

verifyMissingSourceArtifactWarningContract()
verifyArtifactOnlyHistoryListContract()

void verifyPromotionFailureIsolation()
  .then(() => {
    console.log('✅ Graph final-result promotion contracts verified (NAI promote, uploaded dedupe, non-visual skip, video promote, value/metadata/generation-parameter/dimension alias fallback, promotion failure isolation, artifact-only history visibility, MCP/workflow history totals)')
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
