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
  const start = sourceText.indexOf(`export function ${functionName}`)
  assert(start !== -1, `${functionName} export must exist`)

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

function assertExecutionStatusLookupPolicy() {
  const sharedSource = source('features/module-graph/module-graph-shared.tsx')
  const syncSource = source('features/module-graph/use-module-graph-workspace-sync.ts')
  const statusSource = extractFunction(sharedSource, 'getNodeExecutionStatus')
  const buildFlowFromGraphRecordSource = extractFunction(sharedSource, 'buildFlowFromGraphRecord')

  assert(
    sharedSource.includes('export function buildNodeOrderIndex'),
    'module graph execution status should expose a reusable node-order index builder',
  )
  assert(
    statusSource.includes('nodeOrderIndex: ReadonlyMap<string, number>'),
    'execution status resolver should accept the precomputed node-order index',
  )
  assert(
    !statusSource.includes('orderedNodeIds.indexOf'),
    'execution status resolver must not scan orderedNodeIds for every node status check',
  )
  assert(
    syncSource.includes('buildNodeOrderIndex(orderedNodeIds)'),
    'workspace sync should build the node-order index once per execution plan',
  )
  assert(
    syncSource.includes('const orderedNodeIdSet = new Set(orderedNodeIds)'),
    'workspace sync should build the ordered-node membership set once per execution plan',
  )
  assert(
    syncSource.includes('orderedNodeIdSet.has(node.id)'),
    'workspace sync should use Set.has for per-node execution-plan membership',
  )
  assert(
    !syncSource.includes('orderedNodeIds.includes(node.id)'),
    'workspace sync must not scan orderedNodeIds while mapping each node',
  )
  assert(
    buildFlowFromGraphRecordSource.includes('const nodeById = new Map(nodes.map((node) => [node.id, node]))'),
    'saved workflow loading should build a node lookup map once before edge conversion',
  )
  assert(
    buildFlowFromGraphRecordSource.includes('nodeById.get(edge.source_node_id)'),
    'saved workflow loading should use the node lookup for source edge ports',
  )
  assert(
    buildFlowFromGraphRecordSource.includes('nodeById.get(edge.target_node_id)'),
    'saved workflow loading should use the node lookup for target edge ports',
  )
  assert(
    !buildFlowFromGraphRecordSource.includes('nodes.find((node) => node.id === edge.'),
    'saved workflow loading must not scan graph nodes for every edge',
  )
}

assertExecutionStatusLookupPolicy()

console.log('Module graph execution status contracts verified.')
