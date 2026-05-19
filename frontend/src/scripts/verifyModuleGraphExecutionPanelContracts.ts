import { readFileSync } from 'node:fs'

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function extractFunction(sourceText: string, functionName: string) {
  const exportedStart = sourceText.indexOf(`export function ${functionName}`)
  const localStart = sourceText.indexOf(`function ${functionName}`)
  const start = exportedStart !== -1 ? exportedStart : localStart
  assert(start !== -1, `${functionName} function must exist`)

  const bodyStart = sourceText.indexOf('{', start)
  assert(bodyStart !== -1, `${functionName} body must exist`)

  let depth = 0
  for (let index = bodyStart; index < sourceText.length; index += 1) {
    const char = sourceText[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return sourceText.slice(start, index + 1)
      }
    }
  }

  throw new Error(`${functionName} body must be closed`)
}

function assertExecutionPanelLookupPolicy() {
  const helpersSource = source('features/module-graph/components/graph-execution-panel-helpers.ts')
  const groupArtifactsByNodeSource = extractFunction(helpersSource, 'groupArtifactsByNode')
  const pickHighlightedArtifactsSource = extractFunction(helpersSource, 'pickHighlightedArtifacts')

  assert(
    helpersSource.includes('function buildNodeDisplayLabelMap'),
    'execution panel should expose a reusable node-label map builder',
  )
  assert(
    helpersSource.includes('function resolveNodeDisplayLabel'),
    'execution panel should share node-label override/fallback resolution',
  )
  assert(
    groupArtifactsByNodeSource.includes('const nodeLabelMap = buildNodeDisplayLabelMap(selectedGraph)'),
    'grouped artifact rendering should build the node-label map once per grouping pass',
  )
  assert(
    groupArtifactsByNodeSource.includes('resolveNodeDisplayLabel(nodeId, nodeLabelMap.get(nodeId), nodeLabelOverrides)'),
    'grouped artifact rendering should use the precomputed node-label map for each node group',
  )
  assert(
    !groupArtifactsByNodeSource.includes('getNodeDisplayLabel(selectedGraph, nodeId'),
    'grouped artifact rendering must not rebuild or rescan node labels for every node group',
  )
  assert(
    !groupArtifactsByNodeSource.includes('selectedGraph?.graph.nodes.find'),
    'grouped artifact rendering must not scan graph nodes for every artifact group',
  )
  assert(
    pickHighlightedArtifactsSource.includes('const textArtifacts: GraphExecutionArtifactRecord[] = []'),
    'compact artifact picking should partition text artifacts in one pass',
  )
  assert(
    pickHighlightedArtifactsSource.includes('const structuredArtifacts: GraphExecutionArtifactRecord[] = []'),
    'compact artifact picking should partition structured artifacts in one pass',
  )
  assert(
    pickHighlightedArtifactsSource.includes('textArtifacts.push(artifact)'),
    'compact artifact picking should append text artifacts during the partition pass',
  )
  assert(
    pickHighlightedArtifactsSource.includes('structuredArtifacts.push(artifact)'),
    'compact artifact picking should append structured artifacts during the partition pass',
  )
  assert(
    !pickHighlightedArtifactsSource.includes('textArtifacts.includes(artifact)'),
    'compact artifact picking must not scan the text-artifact list for every structured candidate',
  )
}

assertExecutionPanelLookupPolicy()

console.log('Module graph execution panel contracts verified.')
