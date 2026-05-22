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
  const canvasSource = source('features/module-graph/components/module-graph-canvas.tsx')
  const nodeCardSource = source('features/module-graph/components/module-graph-node-card.tsx')
  const nodeCardLayoutsSource = source('features/module-graph/components/module-graph-node-card-layouts.tsx')
  const nodeInspectorSource = source('features/module-graph/components/node-inspector-panel.tsx')
  const groupArtifactsByNodeSource = extractFunction(helpersSource, 'groupArtifactsByNode')
  const pickHighlightedArtifactsSource = extractFunction(helpersSource, 'pickHighlightedArtifacts')
  const recommendationSource = extractFunction(canvasSource, 'getRecommendedModulesFromConnectionStart')
  const actionMenuLookupCount = canvasSource.match(/const targetNode = nodeById\.get\(actionMenuState\.nodeId\)/g)?.length ?? 0

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
  assert(
    nodeCardLayoutsSource.includes('const expandedOutputGroupKeySet = useMemo(() => new Set(expandedOutputGroupKeys), [expandedOutputGroupKeys])'),
    'node card artifact outputs should build one expanded-output key Set per state snapshot',
  )
  assert(
    nodeCardLayoutsSource.includes('export function buildModuleUiFieldMap'),
    'node card layouts should expose a reusable UI-field map builder',
  )
  assert(
    nodeCardSource.includes('const uiFieldByKey = useMemo(() => buildModuleUiFieldMap(module.ui_schema), [module.ui_schema])'),
    'node card should build the module UI-field map once per module schema snapshot',
  )
  assert(
    nodeCardSource.includes('uiFieldByKey.get(port.key)'),
    'node card should use Map-backed UI-field lookup for rendered input ports',
  )
  assert(
    nodeCardSource.includes('uiFieldByKey={uiFieldByKey}'),
    'specialized node card layouts should receive the precomputed UI-field map',
  )
  assert(
    nodeCardLayoutsSource.includes('const resolvedUiFieldByKey = uiFieldByKey ?? fallbackUiFieldByKey'),
    'specialized node card layouts should reuse the supplied UI-field map with a local fallback',
  )
  assert(
    nodeCardLayoutsSource.includes('expandedOutputGroupKeySet.has(group.portKey)'),
    'node card artifact outputs should use Set.has while rendering output groups',
  )
  assert(
    !nodeCardLayoutsSource.includes('const isExpanded = expandedOutputGroupKeys.includes(group.portKey)'),
    'node card artifact outputs must not scan expanded output keys for every rendered group',
  )
  assert(
    nodeInspectorSource.includes('const collapsedOutputGroupKeySet = useMemo(() => new Set(collapsedOutputGroupKeys), [collapsedOutputGroupKeys])'),
    'node inspector should build one collapsed-output key Set per state snapshot',
  )
  assert(
    nodeInspectorSource.includes('collapsedOutputGroupKeySet.has(group.portKey)'),
    'node inspector should use Set.has while rendering output groups',
  )
  assert(
    !nodeInspectorSource.includes('const isCollapsed = collapsedOutputGroupKeys.includes(group.portKey)'),
    'node inspector must not scan collapsed output keys for every rendered group',
  )
  assert(
    canvasSource.includes('export function buildModuleGraphNodeMap'),
    'module graph canvas should expose a reusable node-id map builder',
  )
  assert(
    canvasSource.includes('const nodeById = useMemo(() => buildModuleGraphNodeMap(nodes), [nodes])'),
    'module graph canvas should build one node-id map per node snapshot',
  )
  assert(
    recommendationSource.includes('nodeById: ReadonlyMap<string, ModuleGraphNode>'),
    'recommended-node resolution should receive the precomputed node lookup map',
  )
  assert(
    recommendationSource.includes('const existingNode = nodeById.get(connectionStart.nodeId)'),
    'recommended-node resolution should use the node lookup map for the connection source',
  )
  assert(
    !recommendationSource.includes('nodes.find((node) => node.id === connectionStart.nodeId)'),
    'recommended-node resolution must not scan graph nodes for every connection-source lookup',
  )
  assert(
    canvasSource.includes('getRecommendedModulesFromConnectionStart(modules, nodeById, quickCreateState?.connectionStart ?? null)'),
    'recommended-node memo should pass the precomputed node lookup map',
  )
  assert(
    actionMenuLookupCount === 2,
    'node action menu callbacks should use the node lookup map for both node-target actions',
  )
  assert(
    !canvasSource.includes('const targetNode = nodes.find((node) => node.id === actionMenuState.nodeId)'),
    'node action menu callbacks must not rescan graph nodes by id',
  )
}

assertExecutionPanelLookupPolicy()

console.log('Module graph execution panel contracts verified.')
