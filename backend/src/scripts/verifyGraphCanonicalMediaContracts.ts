import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../../..')

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

function extractFunctionBody(source: string, functionName: string) {
  const marker = `async function ${functionName}`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${functionName} should exist`)

  const signatureStart = source.indexOf('(', start)
  assert.notEqual(signatureStart, -1, `${functionName} should have a parameter signature`)

  let parenDepth = 0
  let signatureEnd = -1
  for (let index = signatureStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '(') {
      parenDepth += 1
    } else if (char === ')') {
      parenDepth -= 1
      if (parenDepth === 0) {
        signatureEnd = index
        break
      }
    }
  }
  assert.notEqual(signatureEnd, -1, `${functionName} should close its parameter signature`)

  const bodyStart = source.indexOf('{', signatureEnd)
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`)

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(bodyStart, index + 1)
      }
    }
  }

  throw new Error(`${functionName} body could not be parsed`)
}

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

assertQueueBackedResolverUsesCanonicalReference(
  'backend/src/services/graph-workflow-executor/execute-comfy.ts',
  'resolveQueueBackedOutput',
)
assertQueueBackedResolverUsesCanonicalReference(
  'backend/src/services/graph-workflow-executor/system-codex-operations.ts',
  'resolveQueueBackedCodexOutput',
)
assertCanonicalMediaHelperCarriesHashMetadata()

console.log('Graph canonical media contract verification passed')
