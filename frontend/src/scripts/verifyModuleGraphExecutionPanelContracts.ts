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
  const nodeCardArtifactOutputsSource = source('features/module-graph/components/module-graph-node-card-layouts/node-artifact-outputs.tsx')
  const nodeCardRandomTextChoiceSource = source('features/module-graph/components/module-graph-node-card-layouts/random-text-choice-node-layout.tsx')
  const nodeCardTextLayoutsSource = source('features/module-graph/components/module-graph-node-card-layouts/text-node-layouts.tsx')
  const nodeCardPortCellsSource = source('features/module-graph/components/module-graph-port-cells.tsx')
  const nodeInspectorSource = source('features/module-graph/components/node-inspector-panel.tsx')
  const nodeInspectorHelpersSource = source('features/module-graph/components/node-inspector-panel-helpers.tsx')
  const artifactSource = source('features/module-graph/module-graph-artifacts.ts')
  const sharedSource = source('features/module-graph/module-graph-shared.tsx')
  const finalResultsSource = source('features/module-graph/components/workflow-final-results-section.tsx')
  const executionLogAlertsSource = source('features/module-graph/components/workflow-execution-log-alerts.ts')
  const workflowRunnerSource = source('features/module-graph/components/workflow-runner-panel.tsx')
  const executionPanelSource = source('features/module-graph/components/graph-execution-panel.tsx')
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
    groupArtifactsByNodeSource.includes('sort(compareGraphArtifactsNewestFirst)'),
    'grouped artifact rendering should use deterministic newest-first artifact ordering',
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
    pickHighlightedArtifactsSource.includes('sort(compareGraphArtifactsNewestFirst)'),
    'compact artifact picking should use deterministic newest-first artifact ordering',
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
    compareGraphArtifactsNewestFirstSource.includes('Date.parse(right.created_date) - Date.parse(left.created_date)')
      && compareGraphArtifactsNewestFirstSource.includes('return right.id - left.id'),
    'workflow artifact ordering should break same-timestamp ties by newest artifact id',
  )
  assert(
    buildNodeArtifactGroupsSource.includes('sort(compareGraphArtifactsNewestFirst)'),
    'node artifact groups should use deterministic newest-first artifact ordering',
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
    nodeCardArtifactOutputsSource.includes('const expandedOutputGroupKeySet = useMemo(() => new Set(expandedOutputGroupKeys), [expandedOutputGroupKeys])'),
    'node card artifact outputs should build one expanded-output key Set per state snapshot',
  )
  assert(
    nodeCardPortCellsSource.includes('export function buildModuleUiFieldMap'),
    'node card port cells should expose a reusable UI-field map builder',
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
    nodeCardRandomTextChoiceSource.includes('export function RandomTextChoiceNodeLayout'),
    'random text choice node should expose a dedicated API-style card layout',
  )
  assert(
    nodeCardTextLayoutsSource.includes('const resolvedUiFieldByKey = uiFieldByKey ?? fallbackUiFieldByKey'),
    'specialized node card layouts should reuse the supplied UI-field map with a local fallback',
  )
  assert(
    nodeCardArtifactOutputsSource.includes('expandedOutputGroupKeySet.has(group.portKey)'),
    'node card artifact outputs should use Set.has while rendering output groups',
  )
  assert(
    !nodeCardArtifactOutputsSource.includes('const isExpanded = expandedOutputGroupKeys.includes(group.portKey)'),
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
    nodeInspectorHelpersSource.includes('sort(compareGraphArtifactsNewestFirst)'),
    'node inspector output groups should use deterministic newest-first artifact ordering',
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
      && finalResultsSource.includes('const nodeLabelMap = useMemo(() => buildNodeDisplayLabelMap(selectedGraph), [selectedGraph])')
      && finalResultsSource.includes('const resolvedEntries = useMemo<ResolvedFinalResultEntry[]>')
      && finalResultsSource.includes('visualEntryByImageId: new Map'),
    'final result rendering should memoize artifact lookup, node-label lookup, resolved entries, and overlay lookup maps',
  )
  assert(
    finalResultsSource.includes('getNodeDisplayLabelFromMap(nodeLabelMap, finalResult.final_node_id, nodeLabelOverrides)')
      && finalResultsSource.includes('getNodeDisplayLabelFromMap(nodeLabelMap, finalResult.source_node_id, nodeLabelOverrides)'),
    'final result rendering should resolve node labels through the precomputed node-label map',
  )
  assert(
    !finalResultsSource.includes('getNodeDisplayLabel(selectedGraph')
      && !finalResultsSource.includes('selectedGraph?.graph.nodes.find'),
    'final result rendering must not rescan graph nodes for every final-result row',
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
    buildFinalResultImageRecordSource.includes("width: readMetadataNumber(metadata, ['actualWidth', 'actual_width', 'outputWidth', 'output_width', 'width'])")
      && buildFinalResultImageRecordSource.includes("height: readMetadataNumber(metadata, ['actualHeight', 'actual_height', 'outputHeight', 'output_height', 'height'])"),
    'final result image records should preserve generated-media dimension aliases before plain width/height metadata',
  )
  assert(
    readMetadataStringSource.includes('for (const key of keys)')
      && readMetadataStringSource.includes('const trimmedValue = value.trim()')
      && readMetadataStringSource.includes('return trimmedValue'),
    'final result image records should preserve non-empty string metadata such as composite hashes',
  )
  assert(
    buildFinalResultPreviewArtifactSource.includes('source_metadata: entry.finalResult.source_metadata')
      && buildFinalResultPreviewArtifactSource.includes('source_storage_path: entry.artifact.storage_path ? undefined : entry.finalResult.source_storage_path'),
    'final result preview artifact should carry source metadata while falling back to source storage only when artifact storage is sparse',
  )
  assert(
    resolveGraphArtifactPreviewMetadataSource.includes('return { ...sourceMetadata, ...artifactMetadata }')
      && artifactSource.includes('const metadata = resolveGraphArtifactPreviewMetadata(artifact)'),
    'artifact previews should merge source metadata as fallback while preserving artifact metadata precedence',
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
    buildFinalResultImageRecordSource.includes("composite_hash: readMetadataString(metadata, ['actualCompositeHash', 'actual_composite_hash', 'compositeHash', 'composite_hash'])")
      && artifactSource.includes('metadata?.actualCompositeHash')
      && artifactSource.includes('metadata?.actual_composite_hash'),
    'final result image records and preview URLs should preserve actual/composite hashes for uploaded media',
  )
  assert(
    resolveFinalResultOriginalFilePathSource.includes("'originalFilePath'")
      && resolveFinalResultOriginalFilePathSource.includes("'outputPath'")
      && resolveFinalResultOriginalFilePathSource.includes("'filePath'")
      && resolveFinalResultOriginalFilePathSource.includes('?? previewArtifact.source_storage_path')
      && buildFinalResultImageRecordSource.includes('original_file_path: resolveFinalResultOriginalFilePath(metadata, previewArtifact)'),
    'final result image records should preserve filename and path aliases before source fallbacks for display names',
  )
  assert(
    artifactSource.includes("['storagePath', 'storage_path', 'outputPath', 'output_path', 'originalFilePath', 'original_file_path', 'filePath', 'file_path']")
      && getArtifactPreviewUrlSource.includes('resolveGraphArtifactStoragePath(artifact, metadata)')
      && resolveGraphArtifactMimeTypeSource.includes("['mimeType', 'mime_type', 'outputMimeType', 'output_mime_type', 'contentType', 'content_type']"),
    'final result previews should preserve camelCase output path and MIME aliases before extension fallback',
  )
  assert(
    finalResultsSource.includes('gridItemHeight={240}'),
    'final result image list should avoid oversized crop-prone preview frames',
  )
  assert(
    finalResultsSource.includes('activationMode="modal"')
      && finalResultsSource.includes('allowEditAction: false')
      && finalResultsSource.includes('allowGroupAssignAction: false'),
    'final result image list should open visual results in the existing image modal without edit/group quick actions',
  )
  assert(
    finalResultsSource.includes('const nextRegisteredVisualEntries = nextVisualEntries.filter')
      && finalResultsSource.includes("typeof item.image.composite_hash === 'string'")
      && finalResultsSource.includes('const nextPreviewOnlyVisualEntries = nextVisualEntries.filter')
      && finalResultsSource.includes('items={registeredVisualEntries.map((item) => item.image)}')
      && finalResultsSource.includes('previewOnlyVisualEntries.map(({ entry }) => {')
      && finalResultsSource.includes('artifact={buildFinalResultPreviewArtifact(entry)}'),
    'final result preview-only visual artifacts should use the artifact preview modal instead of no-op image-list activation',
  )
  assert(
    finalResultsSource.includes("t({ ko: '미디어 {count}', en: 'Media {count}' }, { count: visualEntries.length })")
      && finalResultsSource.includes("t({ ko: '파일 {count}', en: 'Files {count}' }, { count: nonVisualEntries.length })"),
    'final result header should summarize media and non-visual result counts',
  )
  assert(
    finalResultsSource.includes('sourceNodeLabel: getFinalResultSourceNodeLabel(sourceNodeLabel, finalResult.source_node_id)')
      && finalResultsSource.includes('entry.sourceNodeLabel ? <span className="truncate text-white/92">{entry.sourceNodeLabel}</span> : null')
      && finalResultsSource.includes('[overlayLabel, sourceNodeLabel, sourcePortLabel].filter(Boolean).join'),
    'final result overlays should include the source node label alongside the output port',
  )
  assert(
    finalResultsSource.includes("const overlayText = [entry.overlayLabel, entry.sourceNodeLabel, entry.sourcePortLabel, entry.artifact.artifact_type].filter(Boolean).join(' · ')")
      && finalResultsSource.includes('title={overlayText}')
      && finalResultsSource.includes('aria-label={overlayText}'),
    'final result visual overlays should expose the full source context when compact labels truncate',
  )
  assert(
    !finalResultsSource.includes('preferredColumnCount={Math.min(visualEntries.length, 4)}'),
    'final result image list must not force multiple columns in narrow runner panels',
  )
  assert(
    indexCssSource.includes('.workflow-final-results-list .image-list-selectable img') && indexCssSource.includes('object-fit: contain;'),
    'final result preview media should render with object-fit: contain in the scoped result list',
  )
  assert(
    workflowRunnerSource.includes("latestExecution?.status === 'completed'")
      && workflowRunnerSource.includes('shouldShowLatestExecutionResults && latestExecutionArtifacts && latestExecutionFinalResults')
      && workflowRunnerSource.includes('shouldShowLatestExecutionResults ? ('),
    'workflow runner latest-result area should only wait for final-result detail when the latest execution is completed',
  )
  assert(
    pageViewModelSource.includes('const latestExecutionDetailQueryIndex = useMemo(')
      && pageViewModelSource.includes("latestExecution?.status === 'completed'")
      && pageViewModelSource.includes('previewExecutionCandidates.findIndex((execution) => execution.id === latestExecution.id)')
      && pageViewModelSource.includes('const latestExecutionDetailIsLoading = latestExecution?.status === \'completed\'')
      && pageViewModelSource.includes('const latestExecutionDetailError = latestExecution?.status === \'completed\' && latestExecutionDetailQuery?.isError'),
    'workflow runner latest-result detail state should be derived from the matching latest completed execution query',
  )
  assert(
    pageSectionsSource.includes('latestExecutionDetailIsLoading={latestExecutionDetailIsLoading}')
      && pageSectionsSource.includes('latestExecutionDetailError={latestExecutionDetailError}'),
    'workflow runner latest-result detail loading and error state should be passed into the browse side panel',
  )
  assert(
    workflowRunnerSource.includes('const latestExecutionDetailLoadMessage = latestExecutionDetailError')
      && workflowRunnerSource.includes("latestExecutionDetailError ? 'text-destructive' : 'text-muted-foreground'")
      && workflowRunnerSource.includes('Could not load final result details.'),
    'workflow runner latest-result area should show detail load failures instead of a stale loading message',
  )
  assert(
    executionLogAlertsSource.includes("FINAL_RESULT_PROMOTION_FAILED_EVENT = 'final_result_promotion_failed'")
      && executionLogAlertsSource.includes("FINAL_RESULT_SOURCE_ARTIFACT_MISSING_EVENT = 'final_result_source_artifact_missing'")
      && executionLogAlertsSource.includes('listFinalResultLifecycleWarnings')
      && executionLogAlertsSource.includes('log.event_type === FINAL_RESULT_PROMOTION_FAILED_EVENT'),
    'workflow execution log alerts should recognize non-fatal final-result lifecycle warnings from execution logs',
  )
  assert(
    executionLogAlertsSource.includes('const explicitMissingLogs = logs.filter((log) => log.event_type === FINAL_RESULT_SOURCE_ARTIFACT_MISSING_EVENT)')
      && executionLogAlertsSource.includes('explicitMissingLogs.length > 0')
      && executionLogAlertsSource.includes('return listFinalResultLifecycleWarnings(logs)[0] ?? null'),
    'workflow execution log alerts should list multiple warnings without duplicating legacy missing-source fallback logs',
  )
  assert(
    executionLogAlertsSource.includes("details?.operationKey === 'system.final_result'")
      && executionLogAlertsSource.includes("details?.skippedReason === 'source_artifact_not_persisted'")
      && executionLogAlertsSource.includes("buildFinalResultLifecycleWarning('source_artifact_missing'"),
    'workflow execution log alerts should recognize final-result nodes whose source output was not persisted',
  )
  assert(
    executionLogAlertsSource.includes("sourceNodeId: readDetailsString(details, 'sourceNodeId')")
      && executionLogAlertsSource.includes("sourcePortKey: readDetailsString(details, 'sourcePortKey')")
      && executionLogAlertsSource.includes("errorMessage: readDetailsString(details, 'errorMessage')"),
    'workflow execution log alerts should preserve source output context from final-result warning details',
  )
  assert(
    buildFinalResultLifecycleWarningSourceLabelSource.includes('const nodeLabel = sourceNodeLabel?.trim() || warning.sourceNodeId || null')
      && buildFinalResultLifecycleWarningSourceLabelSource.includes('const portLabel = warning.sourcePortKey?.trim() || null')
      && buildFinalResultLifecycleWarningSourceLabelSource.includes("[nodeLabel, portLabel].filter(Boolean).join(' · ')"),
    'final-result warning source labels should combine source node and output port context',
  )
  assert(
    workflowRunnerSource.includes('latestExecutionLogs?: GraphExecutionLogRecord[] | null')
      && workflowRunnerSource.includes('const latestExecutionFinalResultWarnings = useMemo(() => listFinalResultLifecycleWarnings(latestExecutionLogs), [latestExecutionLogs])')
      && workflowRunnerSource.includes('const latestExecutionFinalResultWarning = latestExecutionFinalResultWarnings[0] ?? null')
      && workflowRunnerSource.includes('최종 결과는 저장됐지만 생성 기록 연결은 실패했어. 실행 상세 로그에서 원인을 확인해줘.'),
    'workflow runner latest-result area should surface final-result lifecycle warning logs near the run controls',
  )
  assert(
    workflowRunnerSource.includes('const latestExecutionAdditionalWarningCount = Math.max(0, latestExecutionFinalResultWarnings.length - 1)')
      && workflowRunnerSource.includes('추가 최종 결과 경고 {count}개가 더 있어. 실행 상세 로그에서 함께 확인해줘.'),
    'workflow runner latest-result area should summarize additional final-result lifecycle warnings',
  )
  assert(
    workflowRunnerSource.includes('const nodeLabelMap = useMemo(() => buildNodeDisplayLabelMap(selectedGraph), [selectedGraph])')
      && workflowRunnerSource.includes('getNodeDisplayLabelFromMap(nodeLabelMap, latestExecutionFinalResultWarning.sourceNodeId)')
      && workflowRunnerSource.includes('최종 결과 노드는 실행됐지만 {source} 출력이 저장된 결과물을 만들지 못했어.')
      && workflowRunnerSource.includes('최종 결과는 저장됐지만 {source} 출력의 생성 기록 연결은 실패했어.'),
    'workflow runner final-result warnings should include source node/output context when logs provide it',
  )
  assert(
    workflowRunnerSource.includes('최종 결과 노드는 실행됐지만 연결된 출력이 저장된 결과물을 만들지 못했어. 연결한 출력 포트를 확인해줘.'),
    'workflow runner latest-result area should explain final-result source outputs that were not persisted',
  )
  assert(
    executionPanelSource.includes('const finalResultLifecycleWarnings = useMemo(() => listFinalResultLifecycleWarnings(executionDetail.logs), [executionDetail.logs])')
      && executionPanelSource.includes('const finalResultLifecycleWarning = finalResultLifecycleWarnings[0] ?? null')
      && executionPanelSource.includes('최종 결과는 저장됐지만 생성 기록 연결은 실패했어. 상세 로그에서 원인을 확인해줘.'),
    'selected execution summary should surface final-result lifecycle warning logs before opening detailed logs',
  )
  assert(
    executionPanelSource.includes('const additionalFinalResultWarningCount = Math.max(0, finalResultLifecycleWarnings.length - 1)')
      && executionPanelSource.includes('추가 최종 결과 경고 {count}개가 더 있어. 상세 로그에서 함께 확인해줘.'),
    'selected execution summary should summarize additional final-result lifecycle warnings',
  )
  assert(
    executionPanelSource.includes('const nodeLabelMap = useMemo(() => buildNodeDisplayLabelMap(selectedGraph), [selectedGraph])')
      && executionPanelSource.includes('getNodeDisplayLabelFromMap(nodeLabelMap, finalResultLifecycleWarning.sourceNodeId, nodeLabelOverrides)')
      && executionPanelSource.includes('최종 결과 노드는 실행됐지만 {source} 출력이 저장된 결과물을 만들지 못했어.')
      && executionPanelSource.includes('최종 결과는 저장됐지만 {source} 출력의 생성 기록 연결은 실패했어.'),
    'selected execution summary final-result warnings should include source node/output context when logs provide it',
  )
  assert(
    executionPanelSource.includes('최종 결과 노드는 실행됐지만 연결된 출력이 저장된 결과물을 만들지 못했어. 연결한 출력 포트를 확인해줘.'),
    'selected execution summary should explain final-result source outputs that were not persisted',
  )
  assert(
    pageSectionsSource.includes('latestExecutionLogs={latestExecutionDetail?.logs}'),
    'workflow runner latest-result detail logs should be passed into the browse side panel warning surface',
  )
  assert(
    workflowRunnerSource.includes('const latestExecutionEmptyResultLabel = graphSummary && graphSummary.finalResultNodeCount > 0')
      && workflowRunnerSource.includes('Final result nodes exist, but this run did not finalize any outputs.')
      && workflowRunnerSource.includes('emptyLabel={latestExecutionEmptyResultLabel}'),
    'workflow runner latest-result area should distinguish missing final-result nodes from completed runs with no finalized outputs',
  )
  assert(
    workflowRunnerSource.includes('const latestExecutionResultCountLabel = shouldShowLatestExecutionResults && latestExecutionFinalResults')
      && workflowRunnerSource.includes('latestExecutionResultCountLabel ? (')
      && workflowRunnerSource.includes('latestExecutionFinalResults.length > 0'),
    'workflow runner latest-result header should show loaded final-result count near the run controls',
  )
  assert(
    workflowRunnerSource.includes('const latestExecutionArtifactCount = shouldShowLatestExecutionResults && latestExecutionArtifacts ? latestExecutionArtifacts.length : null')
      && workflowRunnerSource.includes('const latestExecutionArtifactCountLabel = latestExecutionArtifactCount !== null')
      && workflowRunnerSource.includes('latestExecutionArtifactCountLabel ? ('),
    'workflow runner latest-result header should show source artifact count before final-result diagnosis',
  )
  assert(
    workflowRunnerSource.includes("'queued'")
      && workflowRunnerSource.includes("'running'")
      && workflowRunnerSource.includes("'failed'")
      && workflowRunnerSource.includes("'cancelled'")
      && workflowRunnerSource.includes('latestExecutionPendingMessage'),
    'workflow runner latest-result area should show terminal/in-progress status messages instead of a stale loading state',
  )
  assert(
    workflowRunnerSource.includes('getGraphExecutionStatusLabel(latestExecution.status)')
      && workflowRunnerSource.includes('localizeGraphWorkflowErrorMessage(latestExecution.error_message'),
    'workflow runner latest-result status and failure copy should use localized status/error helpers',
  )
  assert(
    pageQueriesSource.includes('function hasActiveGraphExecution(executions: GraphExecutionRecord[] | undefined)')
      && pageQueriesSource.includes("execution.status")
      && pageQueriesSource.includes('refetchInterval: (query) => hasActiveGraphExecution(query.state.data) ? 5_000 : false'),
    'workflow execution list should poll while the selected workflow has queued/running executions so latest-result status can reach terminal detail loading',
  )
  assert(
    apiModuleGraphTypesSource.includes('export interface GraphWorkflowVersionSummaryRecord')
      && apiModuleGraphSource.includes('export async function getGraphWorkflowVersionSummaries')
      && apiModuleGraphSource.includes('/api/graph-workflows/${workflowId}/versions?${searchParams.toString()}'),
    'module graph API client should expose compact saved workflow version summaries',
  )
  assert(
    workflowRunnerSource.includes("queryKey: ['module-graph-workflow-versions', selectedGraph?.id ?? null]")
      && workflowRunnerSource.includes('getGraphWorkflowVersionSummaries(selectedGraph?.id as number)')
      && workflowRunnerSource.includes('WorkflowVersionReviewBlock'),
    'workflow runner should query and render saved workflow version review context',
  )
  assert(
    workflowRunnerSource.includes('function buildWorkflowRuntimeInputDiffEntries')
      && workflowRunnerSource.includes('previousEntries: latestExecutionInputEntries')
      && workflowRunnerSource.includes("entry.status !== 'unchanged'"),
    'workflow runner should diff current runtime inputs against the latest execution input preset',
  )
  assert(
    workflowRunnerSource.includes('latestExecution?.graph_version')
      && workflowRunnerSource.includes('latestExecutionVersion === selectedGraph.version')
      && workflowRunnerSource.includes('최근 실행은 이전 그래프 버전이야. 재실행 전에 변경 내용을 확인해줘.'),
    'workflow runner should warn when the latest run used an older saved workflow version',
  )
  assert(
    pageViewModelSource.includes('const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])'),
    'module graph page view model should build one node-id map per node snapshot',
  )
  assert(
    pageViewModelSource.includes('const uiFieldByKey = new Map((node.data.module.ui_schema ?? []).map((field) => [field.key, field]))')
      && pageViewModelSource.includes('const uiField = uiFieldByKey.get(port.key)'),
    'workflow input candidate derivation should index module UI fields per node instead of scanning per exposed port',
  )
  assert(
    !pageViewModelSource.includes('node.data.module.ui_schema?.find((field) => field.key === port.key)'),
    'workflow input candidate derivation must not scan module UI fields for every exposed port',
  )
  assert(
    pageViewModelSource.includes('const currentNode = nodeById.get(nodeId)')
      && pageViewModelSource.includes('executionOutputGroups: buildNodeArtifactGroups(nodeArtifacts, currentNode?.data.module.output_ports ?? [])'),
    'latest execution previews should use the node lookup map when resolving artifact output ports',
  )
  assert(
    !pageViewModelSource.includes('const currentNode = nodes.find((node) => node.id === nodeId)'),
    'latest execution previews must not rescan graph nodes for every artifact node group',
  )
  assert(
    pageViewModelSource.includes('const selectedNode = useMemo(() => selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null, [nodeById, selectedNodeId])'),
    'selected node lookup should reuse the node-id map',
  )
}

assertExecutionPanelLookupPolicy()

console.log('Module graph execution panel contracts verified.')
