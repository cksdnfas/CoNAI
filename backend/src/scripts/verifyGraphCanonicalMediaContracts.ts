import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import verifyHelpers from '../../../scripts/verify-helpers'

const { createSourceReader, extractFunction: extractFunctionBody, reportVerificationSuccess } = verifyHelpers
const readSource = createSourceReader(resolve(__dirname, '../../..'))

function assertQueueBackedResolverUsesCanonicalReference(relativePath: string, functionName: string) {
  const body = extractFunctionBody(readSource(relativePath), functionName)

  assert.match(
    body,
    /saveCanonicalMediaArtifactReference\(/,
    `${functionName} should persist graph media through the canonical media reference helper`,
  )
  assert.doesNotMatch(
    body,
    /saveArtifactBuffer\(/,
    `${functionName} should not create a duplicate temp graph artifact file`,
  )
}

function assertCanonicalMediaHelperCarriesHashMetadata() {
  const body = extractFunctionBody(
    readSource('backend/src/services/graph-workflow-executor/artifacts.ts'),
    'saveCanonicalMediaArtifactReference',
  )

  assert.match(
    body,
    /saveArtifactFileReference\(/,
    'saveCanonicalMediaArtifactReference should create a graph artifact file reference row',
  )
  assert.match(
    body,
    /kind:\s*'canonical-generated-media'/,
    'saveCanonicalMediaArtifactReference should label canonical media references explicitly',
  )
  assert.match(
    body,
    /actualCompositeHash:\s*options\?\.compositeHash/,
    'saveCanonicalMediaArtifactReference should carry the media hash into graph metadata',
  )
  assert.match(
    body,
    /canonicalPath:\s*storagePath/,
    'saveCanonicalMediaArtifactReference should preserve the canonical media path in metadata',
  )
}

function assertPromotedFinalResultsUseCanonicalMediaReference() {
  const promotionSource = readSource('backend/src/services/graph-workflow-executor/final-result-promotion.ts')
  const resultOperationSource = readSource('backend/src/services/graph-workflow-executor/system-result-operations.ts')

  assert.match(
    promotionSource,
    /replacePromotedFinalResultSourceWithCanonicalMedia/,
    'final-result promotion should expose canonical replacement for promoted temp artifacts',
  )
  assert.match(
    promotionSource,
    /GraphExecutionArtifactModel\.updateStorageAndMetadata/,
    'promoted final-result source artifacts should be updated to canonical media references',
  )
  assert.match(
    promotionSource,
    /ImageUploadService\.getActiveFilePath\(promotionResult\.compositeHash\)/,
    'promoted final-result source replacement should resolve the canonical path from the media hash',
  )
  assert.match(
    promotionSource,
    /kind:\s*'canonical-generated-media'/,
    'promoted final-result source replacement should label canonical media references explicitly',
  )
  assert.match(
    promotionSource,
    /runtimePaths\.tempDir, 'graph-executions'/,
    'promoted final-result source replacement should only delete old graph temp files',
  )
  assert.match(
    resultOperationSource,
    /replacePromotedFinalResultSourceWithCanonicalMedia\(sourceArtifact, promotionResult\)/,
    'final-result node should canonicalize promoted source artifact rows after history promotion',
  )
}

assertQueueBackedResolverUsesCanonicalReference(
  'backend/src/services/graph-workflow-executor/execute-comfy.ts',
  'resolveQueueBackedOutput',
)
assertQueueBackedResolverUsesCanonicalReference(
  'backend/src/services/graph-workflow-executor/system-codex-operations.ts',
  'resolveQueueBackedCodexOutput',
)
assertCanonicalMediaHelperCarriesHashMetadata()
assertPromotedFinalResultsUseCanonicalMediaReference()

reportVerificationSuccess('Graph canonical media contract verification passed')
