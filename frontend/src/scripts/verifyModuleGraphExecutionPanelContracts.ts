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
  const sharedSource = source('features/module-graph/module-graph-shared.tsx')
  const finalResultsSource = source('features/module-graph/components/workflow-final-results-section.tsx')
  const indexCssSource = source('index.css')
  const groupArtifactsByNodeSource = extractFunction(helpersSource, 'groupArtifactsByNode')
  const pickHighlightedArtifactsSource = extractFunction(helpersSource, 'pickHighlightedArtifacts')
  const readMetadataNumberSource = extractFunction(finalResultsSource, 'readMetadataNumber')
  const buildFinalResultPreviewArtifactSource = extractFunction(finalResultsSource, 'buildFinalResultPreviewArtifact')
  const resolveFinalResultMetadataRecordSource = extractFunction(finalResultsSource, 'resolveFinalResultMetadataRecord')
  const buildFinalResultImageRecordSource = extractFunction(finalResultsSource, 'buildFinalResultImageRecord')
  const buildNodeArtifactPreviewSource = extractFunction(sharedSource, 'buildNodeArtifactPreview')
  const buildNodeArtifactGroupsSource = extractFunction(sharedSource, 'buildNodeArtifactGroups')
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
    buildNodeArtifactPreviewSource.includes('for (const artifact of artifacts)'),
    'node artifact preview selection should scan artifacts once without visible/readable list allocations',
  )
  assert(
    buildNodeArtifactPreviewSource.includes('if (hasGraphArtifactVisualPreview(artifact))'),
    'node artifact preview selection should return the first visual artifact during the scan',
  )
  assert(
    !buildNodeArtifactPreviewSource.includes('artifacts.filter'),
    'node artifact preview selection must not allocate filtered artifact lists',
  )
  assert(
    !buildNodeArtifactPreviewSource.includes('visibleArtifacts.find'),
    'node artifact preview selection must not rescan visible artifacts for each priority',
  )
  assert(
    buildNodeArtifactGroupsSource.includes('const groupedArtifacts = new Map<string, GraphExecutionArtifactRecord[]>()'),
    'node artifact grouping should build its port groups directly in a map',
  )
  assert(
    buildNodeArtifactGroupsSource.includes('for (const artifact of artifacts)'),
    'node artifact grouping should skip empty artifacts while grouping in one pass',
  )
  assert(
    !buildNodeArtifactGroupsSource.includes('.filter((artifact) => !isEmptyLlmJsonArtifact(artifact))'),
    'node artifact grouping must not allocate a filtered artifact list before grouping',
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
    nodeCardSource.includes('isRandomTextChoiceModule') && nodeCardSource.includes('getRandomTextChoiceDynamicInputPortKeys(data)'),
    'random text choice node should refresh React Flow internals when dynamic candidate inputs change',
  )
  assert(
    nodeCardLayoutsSource.includes('export function RandomTextChoiceNodeLayout'),
    'random text choice node should expose a dedicated API-style card layout',
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
  assert(
    finalResultsSource.includes('className="workflow-final-results-list"'),
    'final result image list should use the workflow-final-results-list scope class',
  )
  assert(
    finalResultsSource.includes('const artifactsById = useMemo(')
      && finalResultsSource.includes('const resolvedEntries = useMemo<ResolvedFinalResultEntry[]>')
      && finalResultsSource.includes('visualEntryByImageId: new Map'),
    'final result rendering should memoize artifact lookup, resolved entries, and overlay lookup maps',
  )
  assert(
    finalResultsSource.includes('minColumnWidth={160}'),
    'final result image list should allow a practical narrow-panel column width',
  )
  assert(
    readMetadataNumberSource.includes("typeof value === 'string' && value.trim()")
      && readMetadataNumberSource.includes('const parsed = Number(value)')
      && readMetadataNumberSource.includes('Number.isFinite(parsed) ? parsed : null'),
    'final result image records should preserve finite numeric-string width/height metadata',
  )
  assert(
    buildFinalResultPreviewArtifactSource.includes('source_metadata: entry.artifact.metadata ? undefined : entry.finalResult.source_metadata')
      && buildFinalResultPreviewArtifactSource.includes('source_storage_path: entry.artifact.storage_path ? undefined : entry.finalResult.source_storage_path'),
    'final result preview artifact should fall back to source metadata/storage when the artifact row is sparse',
  )
  assert(
    resolveFinalResultMetadataRecordSource.includes('return { ...sourceMetadata, ...artifactMetadata }')
      && resolveFinalResultMetadataRecordSource.includes('return artifactMetadata ?? sourceMetadata'),
    'final result metadata should merge source metadata as fallback while preserving artifact metadata precedence',
  )
  assert(
    buildFinalResultImageRecordSource.includes('const previewArtifact = buildFinalResultPreviewArtifact(entry)')
      && buildFinalResultImageRecordSource.includes('const metadata = resolveFinalResultMetadataRecord(entry)'),
    'final result image records should render from the fallback-aware artifact and metadata helpers',
  )
  assert(
    finalResultsSource.includes('gridItemHeight={240}'),
    'final result image list should avoid oversized crop-prone preview frames',
  )
  assert(
    !finalResultsSource.includes('preferredColumnCount={Math.min(visualEntries.length, 4)}'),
    'final result image list must not force multiple columns in narrow runner panels',
  )
  assert(
    indexCssSource.includes('.workflow-final-results-list .image-list-selectable img') && indexCssSource.includes('object-fit: contain;'),
    'final result preview media should render with object-fit: contain in the scoped result list',
  )
}

assertExecutionPanelLookupPolicy()

console.log('Module graph execution panel contracts verified.')
