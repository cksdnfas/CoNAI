import verifyHelpers from '../../../scripts/verify-helpers'
import type { ModuleDefinitionRecord } from '../lib/api-module-graph'
import {
  MODULE_GRAPH_NODE_CUSTOM_CONTROL_REGISTRY,
  MODULE_GRAPH_NODE_LAYOUT_REGISTRY,
  resolveModuleGraphNodeCustomControls,
  resolveModuleGraphNodeDynamicInputPortKeys,
  resolveModuleGraphNodeLayout,
} from '../features/module-graph/components/module-graph-node-card-operation-registry'
import { resolveModuleGraphNodeCardQueryEnablement } from '../features/module-graph/components/use-module-graph-node-card-queries'

const { assertContract, createSourceReader, extractFunction, reportVerificationSuccess } = verifyHelpers
const source = createSourceReader(new URL('../', import.meta.url))

function moduleDefinition(operationKey: string | null, overrides: Partial<ModuleDefinitionRecord> = {}) {
  return {
    id: 1,
    name: 'Module',
    engine_type: 'system',
    authoring_source: 'manual',
    template_defaults: operationKey ? { operation_key: operationKey } : {},
    exposed_inputs: [],
    output_ports: [],
    version: 1,
    is_active: true,
    created_date: '',
    updated_date: '',
    ...overrides,
  } as ModuleDefinitionRecord
}

/** Execute the extracted pure registry instead of matching renderer function bodies. */
function assertNodeCardOperationRegistryBehavior() {
  const expectedLayouts = new Map(Object.entries(MODULE_GRAPH_NODE_LAYOUT_REGISTRY))
  for (const [operationKey, registration] of expectedLayouts) {
    assertContract(resolveModuleGraphNodeLayout(moduleDefinition(operationKey)) === registration.layoutKey, `${operationKey} should resolve to ${registration.layoutKey}`)
  }
  assertContract(resolveModuleGraphNodeLayout(moduleDefinition(null)) === 'default', 'unknown modules should use the shared default port rows')
  assertContract(resolveModuleGraphNodeLayout(moduleDefinition(null, { name: 'API 요청' })) === 'api-request', 'legacy API Request modules should keep their specialized layout')
  assertContract(resolveModuleGraphNodeCustomControls(moduleDefinition('system.call_llm')).has('llm-model'), 'LLM operation should resolve its model control')
  assertContract(resolveModuleGraphNodeCustomControls(moduleDefinition('system.generate_image_nai')).has('nai-model'), 'NAI operation should resolve its model control')
  assertContract(resolveModuleGraphNodeCustomControls(moduleDefinition(null, { engine_type: 'nai' })).has('nai-model'), 'NAI engine modules should keep their model control')
  assertContract(resolveModuleGraphNodeCustomControls(moduleDefinition(null, { engine_type: 'comfyui' })).has('comfy-target'), 'ComfyUI engine modules should keep their routing control')
  assertContract(Object.keys(MODULE_GRAPH_NODE_CUSTOM_CONTROL_REGISTRY).length >= 4, 'custom controls should remain registered by operation key')

  const apiModule = moduleDefinition('system.api_request')
  const apiDynamicKeys = resolveModuleGraphNodeDynamicInputPortKeys(apiModule, {
    module: apiModule,
    inputValues: { values: [{ key: 'prompt', value: '' }], headers: { Authorization: '' } },
  })
  assertContract(apiDynamicKeys.join('|') === 'values.prompt|headers.Authorization', 'API request registry metadata should execute its dynamic handle resolver')
  const randomModule = moduleDefinition('system.random_text_choice')
  const randomDynamicKeys = resolveModuleGraphNodeDynamicInputPortKeys(randomModule, {
    module: randomModule,
    inputValues: { options: [{ key: 'first', value: 'A' }, { key: 'second', value: 'B' }] },
  })
  assertContract(randomDynamicKeys.join('|') === 'options.first|options.second', 'random choice registry metadata should execute its dynamic handle resolver')
  assertContract(resolveModuleGraphNodeDynamicInputPortKeys(moduleDefinition(null), { module: moduleDefinition(null), inputValues: {} }).length === 0, 'default layouts should not add dynamic handles')
}

function assertNodeCardQueryEnablementBehavior() {
  const disabled = resolveModuleGraphNodeCardQueryEnablement({
    canConfigureComfyTarget: false,
    needsLlmModelOptions: false,
    needsLlmPresetOptions: false,
  })
  assertContract(Object.values(disabled).every((value) => value === false), 'unrelated node cards should keep every specialized query disabled')
  const llm = resolveModuleGraphNodeCardQueryEnablement({
    canConfigureComfyTarget: false,
    needsLlmModelOptions: true,
    needsLlmPresetOptions: true,
  })
  assertContract(llm.llmProviders && llm.llmPresets && !llm.comfyServers && !llm.workflowServers, 'LLM nodes should only enable LLM option queries')
  const comfy = resolveModuleGraphNodeCardQueryEnablement({
    canConfigureComfyTarget: true,
    needsLlmModelOptions: false,
    needsLlmPresetOptions: false,
  })
  assertContract(comfy.comfyServers && comfy.workflowServers && !comfy.llmProviders && !comfy.llmPresets, 'configurable Comfy nodes should enable both server queries only')
}

function assertExecutionPanelLookupPolicy() {
  const helpersSource = source('features/module-graph/components/graph-execution-panel-helpers.ts')
  const canvasSource = source('features/module-graph/components/module-graph-canvas.tsx')
  const nodeCardSource = source('features/module-graph/components/module-graph-node-card.tsx')
  const nodeCardRegistrySource = source('features/module-graph/components/module-graph-node-card-operation-registry.ts')
  const nodeCardCustomControlsSource = source('features/module-graph/components/module-graph-node-custom-controls.tsx')
  const nodeCardQueryHookSource = source('features/module-graph/components/use-module-graph-node-card-queries.ts')
  const nodeCardLayoutRendererSource = source('features/module-graph/components/module-graph-node-layout-renderer.tsx')
  const nodeCardLayoutsSource = source('features/module-graph/components/module-graph-node-card-layouts.tsx')
  const nodeCardArtifactOutputsSource = source('features/module-graph/components/module-graph-node-card-layouts/node-artifact-outputs.tsx')
  const nodeCardDefaultPortRowsSource = source('features/module-graph/components/module-graph-node-card-layouts/default-port-rows.tsx')
  const nodeCardRandomTextChoiceSource = source('features/module-graph/components/module-graph-node-card-layouts/random-text-choice-node-layout.tsx')
  const nodeCardTextLayoutsSource = source('features/module-graph/components/module-graph-node-card-layouts/text-node-layouts.tsx')
  const nodeCardPortCellsSource = source('features/module-graph/components/module-graph-port-cells.tsx')
  const nodeCardSimpleValueInputSource = source('features/module-graph/components/module-graph-simple-value-input.tsx')
  const nodeInspectorSource = source('features/module-graph/components/node-inspector-panel.tsx')
  const nodeInspectorHelpersSource = source('features/module-graph/components/node-inspector-panel-helpers.tsx')
  const artifactSource = source('features/module-graph/module-graph-artifacts.ts')
  const finalResultsSource = source('features/module-graph/components/workflow-final-results-section.tsx')
  const executionLogAlertsSource = source('features/module-graph/components/workflow-execution-log-alerts.ts')
  const workflowRunnerSource = source('features/module-graph/components/workflow-runner-panel.tsx')
  const executionPanelSource = source('features/module-graph/components/graph-execution-panel.tsx')
  const executionPanelSectionsSource = source('features/module-graph/components/graph-execution-panel-sections.tsx')
  const pageSectionsSource = source('features/module-graph/components/module-graph-page-sections.tsx')
  const pageViewModelSource = source('features/module-graph/use-module-graph-page-view-model.ts')
  const pageQueriesSource = source('features/module-graph/use-module-graph-page-queries.ts')
  const apiModuleGraphSource = source('lib/api-module-graph.ts')
  const apiModuleGraphTypesSource = source('lib/api-module-graph-types.ts')
  const indexCssSource = source('index.css')
  const groupArtifactsByNodeSource = extractFunction(helpersSource, 'groupArtifactsByNode')
  const pickHighlightedArtifactsSource = extractFunction(helpersSource, 'pickHighlightedArtifacts')
  const readMetadataNumberSource = extractFunction(finalResultsSource, 'readMetadataNumber')
  const readMetadataStringSource = extractFunction(finalResultsSource, 'readMetadataString')
  const resolveFinalResultOriginalFilePathSource = extractFunction(finalResultsSource, 'resolveFinalResultOriginalFilePath')
  const buildFinalResultPreviewArtifactSource = extractFunction(finalResultsSource, 'buildFinalResultPreviewArtifact')
  const resolveFinalResultMetadataRecordSource = extractFunction(finalResultsSource, 'resolveFinalResultMetadataRecord')
  const buildFinalResultImageRecordSource = extractFunction(finalResultsSource, 'buildFinalResultImageRecord')
  const resolveGraphArtifactPreviewMetadataSource = extractFunction(artifactSource, 'resolveGraphArtifactPreviewMetadata')
  const getArtifactPreviewUrlSource = extractFunction(artifactSource, 'getArtifactPreviewUrl')
  const resolveGraphArtifactMimeTypeSource = extractFunction(artifactSource, 'resolveGraphArtifactMimeType')
  const buildNodeArtifactPreviewSource = extractFunction(artifactSource, 'buildNodeArtifactPreview')
  const buildNodeArtifactGroupsSource = extractFunction(artifactSource, 'buildNodeArtifactGroups')
  const compareGraphArtifactsNewestFirstSource = extractFunction(artifactSource, 'compareGraphArtifactsNewestFirst')
  const buildFinalResultLifecycleWarningSourceLabelSource = extractFunction(executionLogAlertsSource, 'buildFinalResultLifecycleWarningSourceLabel')
  const recommendationSource = extractFunction(canvasSource, 'getRecommendedModulesFromConnectionStart')
  const actionMenuLookupCount = canvasSource.match(/const targetNode = nodeById\.get\(actionMenuState\.nodeId\)/g)?.length ?? 0
  assertContract(
    helpersSource.includes('function buildNodeDisplayLabelMap'),
    'execution panel should expose a reusable node-label map builder',
  )
  assertContract(
    helpersSource.includes('function resolveNodeDisplayLabel'),
    'execution panel should share node-label override/fallback resolution',
  )
  assertContract(
    groupArtifactsByNodeSource.includes('const nodeLabelMap = buildNodeDisplayLabelMap(selectedGraph)'),
    'grouped artifact rendering should build the node-label map once per grouping pass',
  )
  assertContract(
    groupArtifactsByNodeSource.includes('sort(compareGraphArtifactsNewestFirst)'),
    'grouped artifact rendering should use deterministic newest-first artifact ordering',
  )
  assertContract(
    groupArtifactsByNodeSource.includes('resolveNodeDisplayLabel(nodeId, nodeLabelMap.get(nodeId), nodeLabelOverrides)'),
    'grouped artifact rendering should use the precomputed node-label map for each node group',
  )
  assertContract(
    !groupArtifactsByNodeSource.includes('getNodeDisplayLabel(selectedGraph, nodeId'),
    'grouped artifact rendering must not rebuild or rescan node labels for every node group',
  )
  assertContract(
    !groupArtifactsByNodeSource.includes('selectedGraph?.graph.nodes.find'),
    'grouped artifact rendering must not scan graph nodes for every artifact group',
  )
  assertContract(
    pickHighlightedArtifactsSource.includes('const textArtifacts: GraphExecutionArtifactRecord[] = []'),
    'compact artifact picking should partition text artifacts in one pass',
  )
  assertContract(
    pickHighlightedArtifactsSource.includes('sort(compareGraphArtifactsNewestFirst)'),
    'compact artifact picking should use deterministic newest-first artifact ordering',
  )
  assertContract(
    pickHighlightedArtifactsSource.includes('const structuredArtifacts: GraphExecutionArtifactRecord[] = []'),
    'compact artifact picking should partition structured artifacts in one pass',
  )
  assertContract(
    pickHighlightedArtifactsSource.includes('textArtifacts.push(artifact)'),
    'compact artifact picking should append text artifacts during the partition pass',
  )
  assertContract(
    pickHighlightedArtifactsSource.includes('structuredArtifacts.push(artifact)'),
    'compact artifact picking should append structured artifacts during the partition pass',
  )
  assertContract(
    !pickHighlightedArtifactsSource.includes('textArtifacts.includes(artifact)'),
    'compact artifact picking must not scan the text-artifact list for every structured candidate',
  )
  assertContract(
    buildNodeArtifactPreviewSource.includes('for (const artifact of artifacts)'),
    'node artifact preview selection should scan artifacts once without visible/readable list allocations',
  )
  assertContract(
    buildNodeArtifactPreviewSource.includes('if (hasGraphArtifactVisualPreview(artifact))'),
    'node artifact preview selection should return the first visual artifact during the scan',
  )
  assertContract(
    !buildNodeArtifactPreviewSource.includes('artifacts.filter'),
    'node artifact preview selection must not allocate filtered artifact lists',
  )
  assertContract(
    !buildNodeArtifactPreviewSource.includes('visibleArtifacts.find'),
    'node artifact preview selection must not rescan visible artifacts for each priority',
  )
  assertContract(
    buildNodeArtifactGroupsSource.includes('const groupedArtifacts = new Map<string, GraphExecutionArtifactRecord[]>()'),
    'node artifact grouping should build its port groups directly in a map',
  )
  assertContract(
    compareGraphArtifactsNewestFirstSource.includes('Date.parse(right.created_date) - Date.parse(left.created_date)')
      && compareGraphArtifactsNewestFirstSource.includes('return right.id - left.id'),
    'workflow artifact ordering should break same-timestamp ties by newest artifact id',
  )
  assertContract(
    buildNodeArtifactGroupsSource.includes('sort(compareGraphArtifactsNewestFirst)'),
    'node artifact groups should use deterministic newest-first artifact ordering',
  )
  assertContract(
    buildNodeArtifactGroupsSource.includes('for (const artifact of artifacts)'),
    'node artifact grouping should skip empty artifacts while grouping in one pass',
  )
  assertContract(
    !buildNodeArtifactGroupsSource.includes('.filter((artifact) => !isEmptyLlmJsonArtifact(artifact))'),
    'node artifact grouping must not allocate a filtered artifact list before grouping',
  )
  assertContract(
    nodeCardArtifactOutputsSource.includes('const expandedOutputGroupKeySet = useMemo(() => new Set(expandedOutputGroupKeys), [expandedOutputGroupKeys])'),
    'node card artifact outputs should build one expanded-output key Set per state snapshot',
  )
  assertContract(
    nodeCardPortCellsSource.includes('export function buildModuleUiFieldMap'),
    'node card port cells should expose a reusable UI-field map builder',
  )
  assertContract(
    nodeCardSource.includes('const uiFieldByKey = useMemo(() => buildModuleUiFieldMap(module.ui_schema), [module.ui_schema])'),
    'node card should build the module UI-field map once per module schema snapshot',
  )
  assertContract(
    nodeCardSource.includes('uiFieldByKey.get(port.key)'),
    'node card should use Map-backed UI-field lookup for rendered input ports',
  )
  assertContract(
    nodeCardCustomControlsSource.includes("const canConfigureNaiModel = Boolean(controlKeys.has('nai-model')")
      && nodeCardCustomControlsSource.includes('state.canConfigureNaiModel')
      && nodeCardCustomControlsSource.includes('value={state.naiModelValue}'),
    'NAI model inputs should render as node-level dropdown controls when they are not wired',
  )
  assertContract(
    nodeCardLayoutsSource.includes("export * from './module-graph-node-card-layouts/default-port-rows'")
      && nodeCardLayoutRendererSource.includes('<DefaultModulePortRows')
      && nodeCardDefaultPortRowsSource.includes('if (inputPort && !outputPort)')
      && nodeCardDefaultPortRowsSource.includes('if (!inputPort && outputPort)')
      && nodeCardDefaultPortRowsSource.includes('className="grid grid-cols-1"'),
    'node card port rows should give full width to unpaired input or output ports',
  )
  assertContract(
    nodeCardSimpleValueInputSource.includes('formatModuleGraphDefaultOptionLabel')
      && nodeCardSimpleValueInputSource.includes("t({ ko: '기본: {value}', en: 'Default: {value}' }")
      && !nodeCardSimpleValueInputSource.includes('기본값 사용'),
    'module graph dropdown empty options should display the concrete default value instead of a vague default label',
  )
  assertContract(
    nodeCardLayoutRendererSource.includes('uiFieldByKey={uiFieldByKey}'),
    'specialized node card layouts should receive the precomputed UI-field map',
  )
  assertContract(nodeCardSource.includes('resolveModuleGraphNodeDynamicInputPortKeys(module, data)'), 'node card should resolve dynamic handles through operation registry metadata')
  assertContract(
    !nodeCardSource.includes("nodeLayoutKey === 'random-text-choice'")
      && !nodeCardSource.includes("nodeLayoutKey === 'api-request'")
      && !nodeCardSource.includes('getRandomTextChoiceDynamicInputPortKeys')
      && !nodeCardSource.includes('getApiRequestDynamicInputPortKeys'),
    'node-card body must not branch on operation-specific dynamic handle rules',
  )
  assertContract(
    nodeCardRandomTextChoiceSource.includes('export function RandomTextChoiceNodeLayout'),
    'random text choice node should expose a dedicated API-style card layout',
  )
  assertContract(
    nodeCardRandomTextChoiceSource.includes("resolvedUiFieldByKey.get('output_type')")
      && nodeCardRandomTextChoiceSource.includes('data_type: \'any\'')
      && nodeCardRandomTextChoiceSource.includes('ModuleGraphSimpleValueInput'),
    'random item output node should expose an output-type selector and accept typed dynamic candidate values',
  )
  assertContract(
    nodeCardLayoutRendererSource.includes("case 'condition-select':")
      && nodeCardTextLayoutsSource.includes('export function ConditionSelectNodeLayout'),
    'condition-select logic node should have a dedicated compact value-join layout',
  )
  assertContract(
    nodeCardRegistrySource.includes('MODULE_GRAPH_NODE_LAYOUT_REGISTRY')
      && nodeCardSource.includes('resolveModuleGraphNodeLayout(module)')
      && nodeCardSource.includes('<ModuleGraphNodeLayoutRenderer'),
    'node-card operation branching should stay behind the registry and focused renderer boundary',
  )
  assertContract(
    !nodeCardSource.includes('<TextMergeNodeLayout')
      && !nodeCardSource.includes('<RandomTextChoiceNodeLayout')
      && !nodeCardSource.includes('<ApiRequestNodeLayout'),
    'node-card body must not regain operation-specific layout JSX',
  )
  assertContract(
    nodeCardCustomControlsSource.includes('useModuleGraphNodeCardQueries')
      && nodeCardCustomControlsSource.includes("controlKeys.has('nai-model')")
      && nodeCardSource.includes('<ModuleGraphNodeCustomControls'),
    'node-level custom controls should use the registry-backed control view model',
  )
  assertContract(
    nodeCardQueryHookSource.includes("queryKey: ['external-api-llm-options', 'module-graph-node-card']")
      && nodeCardQueryHookSource.includes("queryKey: ['generation-workflow-servers', comfyWorkflowId, 'module-graph-node-card']")
      && nodeCardQueryHookSource.includes('enabled: enabled.llmProviders')
      && nodeCardQueryHookSource.includes('enabled: enabled.workflowServers'),
    'node-card query hook should preserve established cache keys at the extracted boundary',
  )
  assertContract(
    nodeCardTextLayoutsSource.includes('const resolvedUiFieldByKey = uiFieldByKey ?? fallbackUiFieldByKey'),
    'specialized node card layouts should reuse the supplied UI-field map with a local fallback',
  )
  assertContract(
    nodeCardArtifactOutputsSource.includes('expandedOutputGroupKeySet.has(group.portKey)'),
    'node card artifact outputs should use Set.has while rendering output groups',
  )
  assertContract(
    !nodeCardArtifactOutputsSource.includes('const isExpanded = expandedOutputGroupKeys.includes(group.portKey)'),
    'node card artifact outputs must not scan expanded output keys for every rendered group',
  )
  assertContract(
    nodeInspectorSource.includes('const collapsedOutputGroupKeySet = useMemo(() => new Set(collapsedOutputGroupKeys), [collapsedOutputGroupKeys])'),
    'node inspector should build one collapsed-output key Set per state snapshot',
  )
  assertContract(
    nodeInspectorSource.includes('collapsedOutputGroupKeySet.has(group.portKey)'),
    'node inspector should use Set.has while rendering output groups',
  )
  assertContract(
    nodeInspectorHelpersSource.includes('sort(compareGraphArtifactsNewestFirst)'),
    'node inspector output groups should use deterministic newest-first artifact ordering',
  )
  assertContract(
    !nodeInspectorSource.includes('const isCollapsed = collapsedOutputGroupKeys.includes(group.portKey)'),
    'node inspector must not scan collapsed output keys for every rendered group',
  )
  assertContract(
    canvasSource.includes('export function buildModuleGraphNodeMap'),
    'module graph canvas should expose a reusable node-id map builder',
  )
  assertContract(
    canvasSource.includes('const nodeById = useMemo(() => buildModuleGraphNodeMap(nodes), [nodes])'),
    'module graph canvas should build one node-id map per node snapshot',
  )
  assertContract(
    recommendationSource.includes('nodeById: ReadonlyMap<string, ModuleGraphNode>'),
    'recommended-node resolution should receive the precomputed node lookup map',
  )
  assertContract(
    recommendationSource.includes('const existingNode = nodeById.get(connectionStart.nodeId)'),
    'recommended-node resolution should use the node lookup map for the connection source',
  )
  assertContract(
    !recommendationSource.includes('nodes.find((node) => node.id === connectionStart.nodeId)'),
    'recommended-node resolution must not scan graph nodes for every connection-source lookup',
  )
  assertContract(
    canvasSource.includes('getRecommendedModulesFromConnectionStart(modules, nodeById, quickCreateState?.connectionStart ?? null)'),
    'recommended-node memo should pass the precomputed node lookup map',
  )
  assertContract(
    actionMenuLookupCount === 2,
    'node action menu callbacks should use the node lookup map for both node-target actions',
  )
  assertContract(
    !canvasSource.includes('const targetNode = nodes.find((node) => node.id === actionMenuState.nodeId)'),
    'node action menu callbacks must not rescan graph nodes by id',
  )
  assertContract(
    finalResultsSource.includes('className="workflow-final-results-list"'),
    'final result image list should use the workflow-final-results-list scope class',
  )
  assertContract(
    finalResultsSource.includes('const artifactsById = useMemo(')
      && finalResultsSource.includes('const nodeLabelMap = useMemo(() => buildNodeDisplayLabelMap(selectedGraph), [selectedGraph])')
      && finalResultsSource.includes('const resolvedEntries = useMemo<ResolvedFinalResultEntry[]>')
      && finalResultsSource.includes('visualEntryByImageId: new Map'),
    'final result rendering should memoize artifact lookup, node-label lookup, resolved entries, and overlay lookup maps',
  )
  assertContract(
    finalResultsSource.includes('getNodeDisplayLabelFromMap(nodeLabelMap, finalResult.final_node_id, nodeLabelOverrides)')
      && finalResultsSource.includes('getNodeDisplayLabelFromMap(nodeLabelMap, finalResult.source_node_id, nodeLabelOverrides)'),
    'final result rendering should resolve node labels through the precomputed node-label map',
  )
  assertContract(
    !finalResultsSource.includes('getNodeDisplayLabel(selectedGraph')
      && !finalResultsSource.includes('selectedGraph?.graph.nodes.find'),
    'final result rendering must not rescan graph nodes for every final-result row',
  )
  assertContract(
    finalResultsSource.includes('minColumnWidth={160}'),
    'final result image list should allow a practical narrow-panel column width',
  )
  assertContract(
    readMetadataNumberSource.includes("typeof value === 'string' && value.trim()")
      && readMetadataNumberSource.includes('const parsed = Number(value)')
      && readMetadataNumberSource.includes('Number.isFinite(parsed) ? parsed : null'),
    'final result image records should preserve finite numeric-string width/height metadata',
  )
  assertContract(
    buildFinalResultImageRecordSource.includes("width: readMetadataNumber(metadata, ['actualWidth', 'actual_width', 'outputWidth', 'output_width', 'width'])")
      && buildFinalResultImageRecordSource.includes("height: readMetadataNumber(metadata, ['actualHeight', 'actual_height', 'outputHeight', 'output_height', 'height'])"),
    'final result image records should preserve generated-media dimension aliases before plain width/height metadata',
  )
  assertContract(
    readMetadataStringSource.includes('for (const key of keys)')
      && readMetadataStringSource.includes('const trimmedValue = value.trim()')
      && readMetadataStringSource.includes('return trimmedValue'),
    'final result image records should preserve non-empty string metadata such as composite hashes',
  )
  assertContract(
    buildFinalResultPreviewArtifactSource.includes('source_metadata: entry.finalResult.source_metadata')
      && buildFinalResultPreviewArtifactSource.includes('source_storage_path: entry.artifact.storage_path ? undefined : entry.finalResult.source_storage_path'),
    'final result preview artifact should carry source metadata while falling back to source storage only when artifact storage is sparse',
  )
  assertContract(
    resolveGraphArtifactPreviewMetadataSource.includes('return { ...sourceMetadata, ...artifactMetadata }')
      && artifactSource.includes('const metadata = resolveGraphArtifactPreviewMetadata(artifact)'),
    'artifact previews should merge source metadata as fallback while preserving artifact metadata precedence',
  )
  assertContract(
    resolveFinalResultMetadataRecordSource.includes('return { ...sourceMetadata, ...artifactMetadata }')
      && resolveFinalResultMetadataRecordSource.includes('return artifactMetadata ?? sourceMetadata'),
    'final result metadata should merge source metadata as fallback while preserving artifact metadata precedence',
  )
  assertContract(
    buildFinalResultImageRecordSource.includes('const previewArtifact = buildFinalResultPreviewArtifact(entry)')
      && buildFinalResultImageRecordSource.includes('const metadata = resolveFinalResultMetadataRecord(entry)'),
    'final result image records should render from the fallback-aware artifact and metadata helpers',
  )
  assertContract(
    buildFinalResultImageRecordSource.includes("composite_hash: readMetadataString(metadata, ['actualCompositeHash', 'actual_composite_hash', 'compositeHash', 'composite_hash'])")
      && artifactSource.includes('metadata?.actualCompositeHash')
      && artifactSource.includes('metadata?.actual_composite_hash'),
    'final result image records and preview URLs should preserve actual/composite hashes for uploaded media',
  )
  assertContract(
    resolveFinalResultOriginalFilePathSource.includes("'originalFilePath'")
      && resolveFinalResultOriginalFilePathSource.includes("'outputPath'")
      && resolveFinalResultOriginalFilePathSource.includes("'filePath'")
      && resolveFinalResultOriginalFilePathSource.includes('?? previewArtifact.source_storage_path')
      && buildFinalResultImageRecordSource.includes('original_file_path: resolveFinalResultOriginalFilePath(metadata, previewArtifact)'),
    'final result image records should preserve filename and path aliases before source fallbacks for display names',
  )
  assertContract(
    artifactSource.includes("['storagePath', 'storage_path', 'outputPath', 'output_path', 'originalFilePath', 'original_file_path', 'filePath', 'file_path']")
      && getArtifactPreviewUrlSource.includes('resolveGraphArtifactStoragePath(artifact, metadata)')
      && resolveGraphArtifactMimeTypeSource.includes("['mimeType', 'mime_type', 'outputMimeType', 'output_mime_type', 'contentType', 'content_type']"),
    'final result previews should preserve camelCase output path and MIME aliases before extension fallback',
  )
  assertContract(
    finalResultsSource.includes('gridItemHeight={240}'),
    'final result image list should avoid oversized crop-prone preview frames',
  )
  assertContract(
    finalResultsSource.includes('activationMode="modal"')
      && finalResultsSource.includes('allowEditAction: false')
      && finalResultsSource.includes('allowGroupAssignAction: false'),
    'final result image list should open visual results in the existing image modal without edit/group quick actions',
  )
  assertContract(
    finalResultsSource.includes('const nextRegisteredVisualEntries = nextVisualEntries.filter')
      && finalResultsSource.includes("typeof item.image.composite_hash === 'string'")
      && finalResultsSource.includes('const nextPreviewOnlyVisualEntries = nextVisualEntries.filter')
      && finalResultsSource.includes('items={registeredVisualEntries.map((item) => item.image)}')
      && finalResultsSource.includes('previewOnlyVisualEntries.map(({ entry }) => {')
      && finalResultsSource.includes('artifact={buildFinalResultPreviewArtifact(entry)}'),
    'final result preview-only visual artifacts should use the artifact preview modal instead of no-op image-list activation',
  )
  assertContract(
    finalResultsSource.includes("t({ ko: '미디어 {count}', en: 'Media {count}' }, { count: visualEntries.length })")
      && finalResultsSource.includes("t({ ko: '파일 {count}', en: 'Files {count}' }, { count: nonVisualEntries.length })"),
    'final result header should summarize media and non-visual result counts',
  )
  assertContract(
    finalResultsSource.includes('sourceNodeLabel: getFinalResultSourceNodeLabel(sourceNodeLabel, finalResult.source_node_id)')
      && finalResultsSource.includes('entry.sourceNodeLabel ? <span className="truncate text-white/92">{entry.sourceNodeLabel}</span> : null')
      && finalResultsSource.includes('[overlayLabel, sourceNodeLabel, sourcePortLabel].filter(Boolean).join'),
    'final result overlays should include the source node label alongside the output port',
  )
  assertContract(
    finalResultsSource.includes("const overlayText = [entry.overlayLabel, entry.sourceNodeLabel, entry.sourcePortLabel, entry.artifact.artifact_type].filter(Boolean).join(' · ')")
      && finalResultsSource.includes('title={overlayText}')
      && finalResultsSource.includes('aria-label={overlayText}'),
    'final result visual overlays should expose the full source context when compact labels truncate',
  )
  assertContract(
    !finalResultsSource.includes('preferredColumnCount={Math.min(visualEntries.length, 4)}'),
    'final result image list must not force multiple columns in narrow runner panels',
  )
  assertContract(
    indexCssSource.includes('.workflow-final-results-list .image-list-selectable img') && indexCssSource.includes('object-fit: contain;'),
    'final result preview media should render with object-fit: contain in the scoped result list',
  )
  assertContract(
    workflowRunnerSource.includes("latestExecution?.status === 'completed'")
      && workflowRunnerSource.includes('shouldShowLatestExecutionResults && latestExecutionArtifacts && latestExecutionFinalResults')
      && workflowRunnerSource.includes('shouldShowLatestExecutionResults ? ('),
    'workflow runner latest-result area should only wait for final-result detail when the latest execution is completed',
  )
  assertContract(
    pageViewModelSource.includes("const latestCompletedExecutionId = latestExecution?.status === 'completed' ? latestExecution.id : null")
      && pageViewModelSource.includes("queryKey: ['module-graph-execution-detail', latestCompletedExecutionId]")
      && pageViewModelSource.includes('enabled: latestCompletedExecutionId !== null')
      && pageViewModelSource.includes('const latestExecutionDetailIsLoading = latestExecution?.status === \'completed\'')
      && pageViewModelSource.includes('const latestExecutionDetailError = latestExecution?.status === \'completed\' && latestExecutionDetailQuery.isError'),
    'workflow runner latest-result detail state should be derived from the matching latest completed execution query',
  )
  // WF-4: 완료 실행 미리보기는 실행마다 상세를 긁는 N+1 이 아니라 배치 1회로 받아야 한다.
  assertContract(
    pageViewModelSource.includes("queryKey: ['module-graph-execution-previews', previewExecutionIds]")
      && pageViewModelSource.includes('queryFn: () => getGraphExecutionPreviews(previewExecutionIds)')
      && !pageViewModelSource.includes('useQueries('),
    'module graph previews must be fetched as one batch request instead of one detail request per execution',
  )
  assertContract(
    apiModuleGraphSource.includes('export async function getGraphExecutionPreviews')
      && apiModuleGraphSource.includes('/api/graph-workflows/executions/previews?')
      && apiModuleGraphTypesSource.includes('export interface GraphExecutionPreviewBatchRecord'),
    'module graph API client should expose the batch execution preview endpoint',
  )
  assertContract(
    pageQueriesSource.includes('resolveStreamFallbackInterval(')
      && pageQueriesSource.includes("hasActiveGraphExecution(query.state.data) ? 5_000 : false"),
    'module graph execution polling must stay under the shared runtime stream fallback gate',
  )
  assertContract(
    pageSectionsSource.includes('latestExecutionDetailIsLoading={latestExecutionDetailIsLoading}')
      && pageSectionsSource.includes('latestExecutionDetailError={latestExecutionDetailError}'),
    'workflow runner latest-result detail loading and error state should be passed into the browse side panel',
  )
  assertContract(
    workflowRunnerSource.includes('const latestExecutionDetailLoadMessage = latestExecutionDetailError')
      && workflowRunnerSource.includes("latestExecutionDetailError ? 'text-destructive' : 'text-muted-foreground'")
      && workflowRunnerSource.includes('Could not load final result details.'),
    'workflow runner latest-result area should show detail load failures instead of a stale loading message',
  )
  assertContract(
    executionLogAlertsSource.includes("FINAL_RESULT_PROMOTION_FAILED_EVENT = 'final_result_promotion_failed'")
      && executionLogAlertsSource.includes("FINAL_RESULT_SOURCE_ARTIFACT_MISSING_EVENT = 'final_result_source_artifact_missing'")
      && executionLogAlertsSource.includes('listFinalResultLifecycleWarnings')
      && executionLogAlertsSource.includes('log.event_type === FINAL_RESULT_PROMOTION_FAILED_EVENT'),
    'workflow execution log alerts should recognize non-fatal final-result lifecycle warnings from execution logs',
  )
  assertContract(
    executionLogAlertsSource.includes('const explicitMissingLogs = logs.filter((log) => log.event_type === FINAL_RESULT_SOURCE_ARTIFACT_MISSING_EVENT)')
      && executionLogAlertsSource.includes('explicitMissingLogs.length > 0')
      && executionLogAlertsSource.includes('return listFinalResultLifecycleWarnings(logs)[0] ?? null'),
    'workflow execution log alerts should list multiple warnings without duplicating legacy missing-source fallback logs',
  )
  assertContract(
    executionLogAlertsSource.includes("details?.operationKey === 'system.final_result'")
      && executionLogAlertsSource.includes("details?.skippedReason === 'source_artifact_not_persisted'")
      && executionLogAlertsSource.includes("buildFinalResultLifecycleWarning('source_artifact_missing'"),
    'workflow execution log alerts should recognize final-result nodes whose source output was not persisted',
  )
  assertContract(
    executionLogAlertsSource.includes("sourceNodeId: readDetailsString(details, 'sourceNodeId')")
      && executionLogAlertsSource.includes("sourcePortKey: readDetailsString(details, 'sourcePortKey')")
      && executionLogAlertsSource.includes("errorMessage: readDetailsString(details, 'errorMessage')"),
    'workflow execution log alerts should preserve source output context from final-result warning details',
  )
  assertContract(
    buildFinalResultLifecycleWarningSourceLabelSource.includes('const nodeLabel = sourceNodeLabel?.trim() || warning.sourceNodeId || null')
      && buildFinalResultLifecycleWarningSourceLabelSource.includes('const portLabel = warning.sourcePortKey?.trim() || null')
      && buildFinalResultLifecycleWarningSourceLabelSource.includes("[nodeLabel, portLabel].filter(Boolean).join(' · ')"),
    'final-result warning source labels should combine source node and output port context',
  )
  assertContract(
    helpersSource.includes("log.event_type === 'node_skipped_disabled'")
      && helpersSource.includes("log.event_type === 'node_skipped_inactive_branch'")
      && helpersSource.includes("execution.status === 'failed'")
      && helpersSource.includes("id: `blocked:${blockedNodeId}`"),
    'execution panel should derive skipped, failed, and downstream blocked path diagnostics',
  )
  assertContract(
    executionPanelSource.includes('buildExecutionPathDiagnosticRows')
      && executionPanelSource.includes('ExecutionPathDiagnosticsBlock rows={executionPathDiagnosticRows} compact')
      && executionPanelSectionsSource.includes("t({ ko: '경로 진단', en: 'Path diagnostics' })"),
    'execution panel should render compact Korean path diagnostics near selected execution details',
  )
  assertContract(
    executionPanelSectionsSource.includes("row.tone === 'failed'")
      && executionPanelSectionsSource.includes("row.tone === 'blocked'")
      && executionPanelSectionsSource.includes("t({ ko: '원인 {value}', en: 'Cause {value}' }"),
    'execution path diagnostics should label failed, blocked, skipped, and cause context rows',
  )
  assertContract(
    workflowRunnerSource.includes('latestExecutionLogs?: GraphExecutionLogRecord[] | null')
      && workflowRunnerSource.includes('const latestExecutionFinalResultWarnings = useMemo(() => listFinalResultLifecycleWarnings(latestExecutionLogs), [latestExecutionLogs])')
      && workflowRunnerSource.includes('const latestExecutionFinalResultWarning = latestExecutionFinalResultWarnings[0] ?? null')
      && workflowRunnerSource.includes('최종 결과는 저장됐지만 생성 기록 연결은 실패했어. 실행 상세 로그에서 원인을 확인해줘.'),
    'workflow runner latest-result area should surface final-result lifecycle warning logs near the run controls',
  )
  assertContract(
    workflowRunnerSource.includes('const latestExecutionAdditionalWarningCount = Math.max(0, latestExecutionFinalResultWarnings.length - 1)')
      && workflowRunnerSource.includes('추가 최종 결과 경고 {count}개가 더 있어. 실행 상세 로그에서 함께 확인해줘.'),
    'workflow runner latest-result area should summarize additional final-result lifecycle warnings',
  )
  assertContract(
    workflowRunnerSource.includes('const nodeLabelMap = useMemo(() => buildNodeDisplayLabelMap(selectedGraph), [selectedGraph])')
      && workflowRunnerSource.includes('getNodeDisplayLabelFromMap(nodeLabelMap, latestExecutionFinalResultWarning.sourceNodeId)')
      && workflowRunnerSource.includes('최종 결과 노드는 실행됐지만 {source} 출력이 저장된 결과물을 만들지 못했어.')
      && workflowRunnerSource.includes('최종 결과는 저장됐지만 {source} 출력의 생성 기록 연결은 실패했어.'),
    'workflow runner final-result warnings should include source node/output context when logs provide it',
  )
  assertContract(
    workflowRunnerSource.includes('최종 결과 노드는 실행됐지만 연결된 출력이 저장된 결과물을 만들지 못했어. 연결한 출력 포트를 확인해줘.'),
    'workflow runner latest-result area should explain final-result source outputs that were not persisted',
  )
  assertContract(
    executionPanelSource.includes('const finalResultLifecycleWarnings = useMemo(() => listFinalResultLifecycleWarnings(executionDetail.logs), [executionDetail.logs])')
      && executionPanelSource.includes('const finalResultLifecycleWarning = finalResultLifecycleWarnings[0] ?? null')
      && executionPanelSource.includes('최종 결과는 저장됐지만 생성 기록 연결은 실패했어. 상세 로그에서 원인을 확인해줘.'),
    'selected execution summary should surface final-result lifecycle warning logs before opening detailed logs',
  )
  assertContract(
    executionPanelSource.includes('const additionalFinalResultWarningCount = Math.max(0, finalResultLifecycleWarnings.length - 1)')
      && executionPanelSource.includes('추가 최종 결과 경고 {count}개가 더 있어. 상세 로그에서 함께 확인해줘.'),
    'selected execution summary should summarize additional final-result lifecycle warnings',
  )
  assertContract(
    executionPanelSource.includes('const nodeLabelMap = useMemo(() => buildNodeDisplayLabelMap(selectedGraph), [selectedGraph])')
      && executionPanelSource.includes('getNodeDisplayLabelFromMap(nodeLabelMap, finalResultLifecycleWarning.sourceNodeId, nodeLabelOverrides)')
      && executionPanelSource.includes('최종 결과 노드는 실행됐지만 {source} 출력이 저장된 결과물을 만들지 못했어.')
      && executionPanelSource.includes('최종 결과는 저장됐지만 {source} 출력의 생성 기록 연결은 실패했어.'),
    'selected execution summary final-result warnings should include source node/output context when logs provide it',
  )
  assertContract(
    executionPanelSource.includes('최종 결과 노드는 실행됐지만 연결된 출력이 저장된 결과물을 만들지 못했어. 연결한 출력 포트를 확인해줘.'),
    'selected execution summary should explain final-result source outputs that were not persisted',
  )
  assertContract(
    pageSectionsSource.includes('latestExecutionLogs={latestExecutionDetail?.logs}'),
    'workflow runner latest-result detail logs should be passed into the browse side panel warning surface',
  )
  assertContract(
    workflowRunnerSource.includes('const latestExecutionEmptyResultLabel = graphSummary && graphSummary.finalResultNodeCount > 0')
      && workflowRunnerSource.includes('Final result nodes exist, but this run did not finalize any outputs.')
      && workflowRunnerSource.includes('emptyLabel={latestExecutionEmptyResultLabel}'),
    'workflow runner latest-result area should distinguish missing final-result nodes from completed runs with no finalized outputs',
  )
  assertContract(
    workflowRunnerSource.includes('const latestExecutionResultCountLabel = shouldShowLatestExecutionResults && latestExecutionFinalResults')
      && workflowRunnerSource.includes('latestExecutionResultCountLabel ? (')
      && workflowRunnerSource.includes('latestExecutionFinalResults.length > 0'),
    'workflow runner latest-result header should show loaded final-result count near the run controls',
  )
  assertContract(
    workflowRunnerSource.includes('const latestExecutionArtifactCount = shouldShowLatestExecutionResults && latestExecutionArtifacts ? latestExecutionArtifacts.length : null')
      && workflowRunnerSource.includes('const latestExecutionArtifactCountLabel = latestExecutionArtifactCount !== null')
      && workflowRunnerSource.includes('latestExecutionArtifactCountLabel ? ('),
    'workflow runner latest-result header should show source artifact count before final-result diagnosis',
  )
  assertContract(
    workflowRunnerSource.includes("'queued'")
      && workflowRunnerSource.includes("'running'")
      && workflowRunnerSource.includes("'failed'")
      && workflowRunnerSource.includes("'cancelled'")
      && workflowRunnerSource.includes('latestExecutionPendingMessage'),
    'workflow runner latest-result area should show terminal/in-progress status messages instead of a stale loading state',
  )
  assertContract(
    workflowRunnerSource.includes('getGraphExecutionStatusLabel(latestExecution.status)')
      && workflowRunnerSource.includes('localizeGraphWorkflowErrorMessage(latestExecution.error_message'),
    'workflow runner latest-result status and failure copy should use localized status/error helpers',
  )
  // WF-4: 5초 폴링 결정은 그대로 살아 있어야 하고(스트림이 죽으면 폴백으로 되살아난다),
  // 다만 SSE 가 살아 있는 동안에는 공유 스트림 게이트가 폴링을 눌러 준다.
  assertContract(
    pageQueriesSource.includes('function hasActiveGraphExecution(executions: GraphExecutionRecord[] | undefined)')
      && pageQueriesSource.includes("execution.status")
      && pageQueriesSource.includes('hasActiveGraphExecution(query.state.data) ? 5_000 : false')
      && pageQueriesSource.includes('refetchInterval: (query) => resolveStreamFallbackInterval('),
    'workflow execution list should poll while the selected workflow has queued/running executions so latest-result status can reach terminal detail loading',
  )
  assertContract(
    apiModuleGraphTypesSource.includes('export interface GraphWorkflowVersionSummaryRecord')
      && apiModuleGraphSource.includes('export async function getGraphWorkflowVersionSummaries')
      && apiModuleGraphSource.includes('/api/graph-workflows/${workflowId}/versions?${searchParams.toString()}'),
    'module graph API client should expose compact saved workflow version summaries',
  )
  // 워크플로우 버전 리뷰 블록은 b1ffb043 "fix(generation): simplify workflow interface" 에서
  // 러너 패널 밖으로 걷어냈다(그때 이 스크립트가 함께 갱신되지 않아 계약이 낡아 있었다).
  // 버전 요약 API 자체는 위 어서션이 계속 지키므로, 여기서는 러너 패널이 그 UI 를 되살리지
  // 않았다는 사실만 확인한다.
  assertContract(
    !workflowRunnerSource.includes('WorkflowVersionReviewBlock'),
    'workflow runner no longer owns the saved workflow version review block',
  )
  // 런타임 입력 diff 와 그래프 버전 경고도 같은 커밋(b1ffb043)에서 러너 패널에서 제거됐다.
  assertContract(
    !workflowRunnerSource.includes('buildWorkflowRuntimeInputDiffEntries')
      && !workflowRunnerSource.includes('latestExecutionVersion === selectedGraph.version'),
    'workflow runner no longer owns runtime input diffing or the stale graph version warning',
  )
  assertContract(
    pageViewModelSource.includes('const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])'),
    'module graph page view model should build one node-id map per node snapshot',
  )
  assertContract(
    pageViewModelSource.includes('const uiFieldByKey = new Map((node.data.module.ui_schema ?? []).map((field) => [field.key, field]))')
      && pageViewModelSource.includes('const uiField = uiFieldByKey.get(port.key)'),
    'workflow input candidate derivation should index module UI fields per node instead of scanning per exposed port',
  )
  assertContract(
    !pageViewModelSource.includes('node.data.module.ui_schema?.find((field) => field.key === port.key)'),
    'workflow input candidate derivation must not scan module UI fields for every exposed port',
  )
  assertContract(
    pageViewModelSource.includes('const currentNode = nodeById.get(nodeId)')
      && pageViewModelSource.includes('executionOutputGroups: buildNodeArtifactGroups(nodeArtifacts, currentNode?.data.module.output_ports ?? [])'),
    'latest execution previews should use the node lookup map when resolving artifact output ports',
  )
  assertContract(
    !pageViewModelSource.includes('const currentNode = nodes.find((node) => node.id === nodeId)'),
    'latest execution previews must not rescan graph nodes for every artifact node group',
  )
  assertContract(
    pageViewModelSource.includes('const selectedNode = useMemo(() => selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null, [nodeById, selectedNodeId])'),
    'selected node lookup should reuse the node-id map',
  )
}

assertNodeCardOperationRegistryBehavior()
assertNodeCardQueryEnablementBehavior()
assertExecutionPanelLookupPolicy()

reportVerificationSuccess('Module graph execution panel contracts verified.')
