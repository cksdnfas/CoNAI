import { deepEqual, doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildExecutionComparisonRows, buildExecutionComparisonSummary } from '../features/module-graph/components/graph-execution-panel-helpers'
import { resolveModuleWorkflowOutputProgress } from '../features/module-graph/module-workflow-output-progress'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord, GraphExecutionLogRecord, GraphExecutionNodeIoRecord, GraphExecutionRecord, GraphWorkflowBrowseContentRecord, GraphWorkflowRecord } from '../lib/api-module-graph'

const root = resolve(process.cwd(), 'src')

function source(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const firstPage = resolveModuleWorkflowOutputProgress({ page: 1, pageSize: 50, visibleCount: 50, totalCount: 180 })
deepEqual(firstPage, {
  start: 1,
  end: 50,
  visibleCount: 50,
  totalCount: 180,
  hiddenCount: 130,
})

const middlePage = resolveModuleWorkflowOutputProgress({ page: 2, pageSize: 50, visibleCount: 50, totalCount: 180 })
deepEqual(middlePage, {
  start: 51,
  end: 100,
  visibleCount: 50,
  totalCount: 180,
  hiddenCount: 80,
})

const lastPage = resolveModuleWorkflowOutputProgress({ page: 4, pageSize: 50, visibleCount: 30, totalCount: 180 })
deepEqual(lastPage, {
  start: 151,
  end: 180,
  visibleCount: 30,
  totalCount: 180,
  hiddenCount: 0,
})

const empty = resolveModuleWorkflowOutputProgress({ page: 1, pageSize: 50, visibleCount: 0, totalCount: 0 })
deepEqual(empty, {
  start: 0,
  end: 0,
  visibleCount: 0,
  totalCount: 0,
  hiddenCount: 0,
})

const clamped = resolveModuleWorkflowOutputProgress({ page: 99, pageSize: 50, visibleCount: 5, totalCount: 55 })
deepEqual(clamped, {
  start: 51,
  end: 55,
  visibleCount: 5,
  totalCount: 55,
  hiddenCount: 0,
})

const { buildModuleWorkflowOutputCollections } = await import('../features/module-graph/components/module-workflow-output-management-panel-helpers')

const workflow: GraphWorkflowRecord = {
  id: 10,
  name: 'Mask workflow',
  graph: { nodes: [], edges: [] },
  version: 1,
  is_active: true,
  created_date: '2026-05-30T02:00:00.000Z',
  updated_date: '2026-05-30T02:00:00.000Z',
}
const execution: GraphExecutionRecord = {
  id: 20,
  graph_workflow_id: workflow.id,
  graph_version: 1,
  status: 'completed',
  created_date: '2026-05-30T02:00:00.000Z',
  updated_date: '2026-05-30T02:00:00.000Z',
}
const maskArtifact: GraphExecutionArtifactRecord = {
  id: 30,
  execution_id: execution.id,
  node_id: 'mask-node',
  port_key: 'mask',
  artifact_type: 'mask',
  storage_path: 'C:/tmp/graph-executions/20/mask.png',
  metadata: JSON.stringify({ label: 'Mask preview' }),
  created_date: '2026-05-30T02:00:00.000Z',
}
const newerSameTimestampMaskArtifact: GraphExecutionArtifactRecord = {
  id: 31,
  execution_id: execution.id,
  node_id: 'mask-node-2',
  port_key: 'mask',
  artifact_type: 'mask',
  storage_path: 'C:/tmp/graph-executions/20/mask-2.png',
  metadata: JSON.stringify({ label: 'Mask preview 2' }),
  created_date: '2026-05-30T02:00:00.000Z',
}
const textArtifact: GraphExecutionArtifactRecord = {
  id: 32,
  execution_id: execution.id,
  node_id: 'text-node',
  port_key: 'text',
  artifact_type: 'text',
  storage_path: null,
  metadata: JSON.stringify({ value: 'older same timestamp text' }),
  created_date: '2026-05-30T02:00:00.000Z',
}
const newerSameTimestampTextArtifact: GraphExecutionArtifactRecord = {
  id: 33,
  execution_id: execution.id,
  node_id: 'text-node-2',
  port_key: 'text',
  artifact_type: 'text',
  storage_path: null,
  metadata: JSON.stringify({ value: 'newer same timestamp text' }),
  created_date: '2026-05-30T02:00:00.000Z',
}
const maskFinalResult: GraphExecutionFinalResultRecord = {
  id: 40,
  execution_id: execution.id,
  final_node_id: 'final-mask',
  source_artifact_id: maskArtifact.id,
  source_node_id: maskArtifact.node_id,
  source_port_key: maskArtifact.port_key,
  artifact_type: 'mask',
  source_storage_path: null,
  source_metadata: null,
  created_date: '2026-05-30T02:00:00.000Z',
}
const newerSameTimestampMaskFinalResult: GraphExecutionFinalResultRecord = {
  id: 41,
  execution_id: execution.id,
  final_node_id: 'final-mask-2',
  source_artifact_id: newerSameTimestampMaskArtifact.id,
  source_node_id: newerSameTimestampMaskArtifact.node_id,
  source_port_key: newerSameTimestampMaskArtifact.port_key,
  artifact_type: 'mask',
  source_storage_path: null,
  source_metadata: null,
  created_date: '2026-05-30T02:00:00.000Z',
}
const compactInputIo: GraphExecutionNodeIoRecord = {
  id: 50,
  execution_id: execution.id,
  node_id: 'final-mask',
  direction: 'input',
  port_key: 'image',
  source_node_id: 'mask-node',
  source_port_key: 'mask',
  output_index: 1,
  artifact_type: 'mask',
  ref_kind: 'node_output',
  ref_value: 'mask-node.mask#1',
  summary: JSON.stringify({
    sourceArtifactId: maskArtifact.id,
    sourceRefKind: 'file_path',
    sourceRefValue: maskArtifact.storage_path,
  }),
  created_date: '2026-05-30T02:00:00.000Z',
}
const compactOutputIo: GraphExecutionNodeIoRecord = {
  id: 51,
  execution_id: execution.id,
  node_id: 'mask-node',
  direction: 'output',
  port_key: 'mask',
  output_index: 1,
  artifact_type: 'mask',
  ref_kind: 'file_path',
  ref_value: maskArtifact.storage_path,
  summary: JSON.stringify({
    artifactRecordId: maskArtifact.id,
    metadataKind: 'mask-output',
    mimeType: 'image/png',
    fileName: 'mask.png',
    value: { valueKind: 'object', size: 128, hash: 'abcdef0123456789' },
  }),
  created_date: '2026-05-30T02:00:00.000Z',
}
const finalResultWarningLog: GraphExecutionLogRecord = {
  id: 60,
  execution_id: execution.id,
  node_id: 'final-mask',
  level: 'warn',
  event_type: 'final_result_source_artifact_missing',
  message: 'missing source',
  details: JSON.stringify({ sourceNodeId: 'mask-node', sourcePortKey: 'mask' }),
  created_date: '2026-05-30T02:00:00.000Z',
}
const comparisonSummary = buildExecutionComparisonSummary({
  inputEntries: [{ key: 'prompt', label: 'Prompt', value: 'same input' }],
  artifacts: [maskArtifact],
  finalResults: [maskFinalResult],
  logs: [finalResultWarningLog],
  nodeIo: [compactInputIo, compactOutputIo],
})
deepEqual(comparisonSummary, {
  runtimeInputCount: 1,
  compactInputCount: 1,
  compactOutputCount: 1,
  artifactCount: 1,
  finalResultCount: 1,
  issueLogCount: 1,
  finalResultWarningCount: 1,
})
const comparisonRows = buildExecutionComparisonRows([compactInputIo, compactOutputIo], workflow)
deepEqual(
  comparisonRows.map((row) => [row.direction, row.nodeLabel, row.portKey, row.sourceLabel, row.artifactType]),
  [
    ['input', '노드 final-mask', 'image', '노드 mask-node · mask', 'mask'],
    ['output', '노드 mask-node', 'mask', null, 'mask'],
  ],
)
match(comparisonRows[0]?.summaryText ?? '', /source #30/)
match(comparisonRows[1]?.summaryText ?? '', /artifact #30/)
const outputCollections = buildModuleWorkflowOutputCollections({
  browseContent: {
    scope: {
      folder_id: null,
      folder_ids: null,
      workflow_count: 1,
      execution_count: 1,
      schedule_count: 0,
      artifact_count: 4,
      final_result_count: 2,
      empty_execution_count: 0,
    },
    workflows: [workflow],
    schedules: [],
    executions: [execution],
    artifacts: [maskArtifact, newerSameTimestampMaskArtifact, textArtifact, newerSameTimestampTextArtifact],
    final_results: [maskFinalResult, newerSameTimestampMaskFinalResult],
    empty_executions: [],
  } satisfies GraphWorkflowBrowseContentRecord,
  executionById: new Map([[execution.id, execution]]),
  workflowNameById: new Map([[workflow.id, workflow.name]]),
})
deepEqual(
  outputCollections.outputItems.map((item) => [item.id, item.type, item.workflowName]),
  [
    [`final-${newerSameTimestampMaskFinalResult.id}`, 'mask', workflow.name],
    [`final-${maskFinalResult.id}`, 'mask', workflow.name],
  ],
)
deepEqual(outputCollections.outputItems.map((item) => [item.storagePath, item.downloadName, item.label]), [
  [newerSameTimestampMaskArtifact.storage_path, 'mask-2.png', 'Mask preview 2'],
  [maskArtifact.storage_path, 'mask.png', 'Mask preview'],
])
match(
  outputCollections.outputItems[0]?.previewUrl ?? '',
  /\/temp\/graph-executions\/20\/mask-2\.png/,
  'sparse final-result rows should recover preview URLs from their source artifacts',
)
deepEqual(
  outputCollections.technicalArtifacts.map((artifact) => artifact.id),
  [newerSameTimestampTextArtifact.id, textArtifact.id],
)

const outputManagementSource = source('features/module-graph/components/module-workflow-output-management-panel.tsx')
const artifactRecordsSource = source('features/module-graph/components/module-workflow-artifact-records-tab.tsx')
const generatedOutputsSource = source('features/module-graph/components/module-workflow-generated-outputs-tab.tsx')
const outputManagementHelpersSource = source('features/module-graph/components/module-workflow-output-management-panel-helpers.ts')
const workflowFinalResultsSectionSource = source('features/module-graph/components/workflow-final-results-section.tsx')
const apiModuleGraphSource = source('lib/api-module-graph.ts')
const graphExecutionPanelSource = source('features/module-graph/components/graph-execution-panel.tsx')
const workflowRunnerSource = source('features/module-graph/components/workflow-runner-panel.tsx')
const pageSectionsSource = source('features/module-graph/components/module-graph-page-sections.tsx')

match(
  apiModuleGraphSource,
  /node_io: GraphExecutionNodeIoRecord\[\]/,
  'execution detail API type should preserve compact node input/output ledger rows',
)
match(
  graphExecutionPanelSource,
  /ExecutionComparisonContextBlock/,
  'execution detail panel should render a compare-ready context block',
)
match(
  graphExecutionPanelSource,
  /scrollToDetailSection\('compare'\)/,
  'execution detail modal should expose compare-context navigation',
)
match(
  graphExecutionPanelSource,
  /executionDetail\.node_io \?\? \[\]/,
  'execution detail panel should feed compact node input/output rows into comparison helpers',
)
match(
  workflowRunnerSource,
  /latestExecutionNodeIo\?: GraphExecutionNodeIoRecord\[\] \| null/,
  'workflow runner latest-result summary should accept compact node input/output rows',
)
match(
  workflowRunnerSource,
  /입출력 \{count\}/,
  'workflow runner latest-result summary should expose compact input/output counts',
)
match(
  pageSectionsSource,
  /latestExecutionNodeIo=\{latestExecutionDetail\?\.node_io\}/,
  'module graph page should pass latest execution node I/O rows into the runner summary',
)

match(
  outputManagementSource,
  /const selectedOutputIdSet = useMemo\([\s\S]*?\(\) => new Set\(selectedOutputIds\)[\s\S]*?\[selectedOutputIds\][\s\S]*?\)/,
  'workflow output management should memoize selected output ids for bulk lookups',
)
match(
  outputManagementSource,
  /const selectedArtifactIdSet = useMemo\([\s\S]*?\(\) => new Set\(selectedArtifactIds\)[\s\S]*?\[selectedArtifactIds\][\s\S]*?\)/,
  'workflow output management should memoize selected artifact ids for bulk lookups',
)
match(
  outputManagementSource,
  /selectedOutputIdSet\.has\(item\.id\)/,
  'selected output derivation should use Set.has instead of scanning selectedOutputIds',
)
match(
  outputManagementSource,
  /selectedArtifactIdSet\.has\(artifact\.id\)/,
  'selected artifact derivation should use Set.has instead of scanning selectedArtifactIds',
)
match(
  outputManagementSource,
  /const pagedOutputIdSet = useMemo\([\s\S]*?new Set\(pagedOutputItems\.map\(\(item\) => item\.id\)\)[\s\S]*?\[pagedOutputItems\][\s\S]*?\)/,
  'paged output ids should be indexed once for visible image and clear-selection lookups',
)
match(
  outputManagementSource,
  /const outputItemIdSet = useMemo\([\s\S]*?new Set\(outputCollections\.outputItems\.map\(\(item\) => item\.id\)\)[\s\S]*?\[outputCollections\.outputItems\][\s\S]*?\)/,
  'all output ids should be indexed once for stale-selection pruning',
)
match(
  outputManagementSource,
  /const pagedArtifactIdSet = useMemo\([\s\S]*?new Set\(pagedTechnicalArtifacts\.map\(\(artifact\) => artifact\.id\)\)[\s\S]*?\[pagedTechnicalArtifacts\][\s\S]*?\)/,
  'paged artifact ids should be indexed once for clear-selection lookups',
)
match(
  outputManagementSource,
  /const filteredArtifactIdSet = useMemo\([\s\S]*?new Set\(filteredTechnicalArtifacts\.map\(\(artifact\) => artifact\.id\)\)[\s\S]*?\[filteredTechnicalArtifacts\][\s\S]*?\)/,
  'filtered artifact ids should be indexed once for stale-selection pruning',
)
doesNotMatch(
  outputManagementSource,
  /selectedOutputIds\.includes\(item\.id\)/,
  'workflow output management must not scan selectedOutputIds per output item',
)
doesNotMatch(
  outputManagementSource,
  /selectedArtifactIds\.includes\(artifact\.id\)/,
  'workflow output management must not scan selectedArtifactIds per artifact item',
)
match(
  outputManagementSource,
  /current\.filter\(\(id\) => outputItemIdSet\.has\(id\)\)/,
  'selected output pruning should use the memoized all-output id Set',
)
match(
  outputManagementSource,
  /current\.filter\(\(id\) => filteredArtifactIdSet\.has\(id\)\)/,
  'selected artifact pruning should use the memoized filtered-artifact id Set',
)
doesNotMatch(
  outputManagementSource,
  /outputCollections\.outputItems\.some\(\(item\) => item\.id === id\)/,
  'selected output pruning must not rescan all output items for every selected id',
)
doesNotMatch(
  outputManagementSource,
  /filteredTechnicalArtifacts\.some\(\(artifact\) => artifact\.id === id\)/,
  'selected artifact pruning must not rescan all filtered artifacts for every selected id',
)

match(
  artifactRecordsSource,
  /const selectedArtifactIdSet = useMemo\([\s\S]*?\(\) => new Set\(selectedArtifactIds\)[\s\S]*?\[selectedArtifactIds\][\s\S]*?\)/,
  'artifact records tab should build one selected-artifact Set per selected ids snapshot',
)
match(
  artifactRecordsSource,
  /const isSelected = selectedArtifactIdSet\.has\(artifact\.id\)/,
  'artifact record row selected state should use Set.has for paged row rendering',
)
doesNotMatch(
  artifactRecordsSource,
  /selectedArtifactIds\.includes\(artifact\.id\)/,
  'artifact record row rendering must not scan selectedArtifactIds per artifact row',
)

match(
  outputManagementSource,
  /const handleDownloadItems = useCallback\(\(items: ModuleWorkflowGeneratedOutputItem\[\]\) => \{[\s\S]*?setIsDownloading\(false\)[\s\S]*?\}, \[\]\)/,
  'generated-output download handler should keep a stable identity for image-grid overlay renderers',
)
match(
  generatedOutputsSource,
  /const selectedCopyTargetFolder = useMemo\([\s\S]*?watchedFolders\.find\(\(folder\) => String\(folder\.id\) === copyTargetFolderId\)[\s\S]*?\[copyTargetFolderId, watchedFolders\][\s\S]*?\)/,
  'generated outputs tab should resolve the selected copy target once per folder snapshot',
)
match(
  generatedOutputsSource,
  /const getGeneratedOutputImageId = useCallback\(\(image: ImageRecord\) => String\(image\.id\), \[\]\)/,
  'generated outputs tab should pass a stable image id resolver into ImageList',
)
match(
  generatedOutputsSource,
  /const renderGeneratedOutputOverlay = useCallback\(\(image: ImageRecord\) => \{[\s\S]*?outputItemById\.get\(String\(image\.id\)\)[\s\S]*?\[isDownloading, onDownloadItems, outputItemById, t\][\s\S]*?\)/,
  'generated outputs tab should memoize image-grid overlay rendering around the output lookup map',
)
match(
  generatedOutputsSource,
  /getItemId=\{getGeneratedOutputImageId\}/,
  'generated outputs ImageList should consume the stable image id resolver',
)
match(
  generatedOutputsSource,
  /renderItemOverlay=\{renderGeneratedOutputOverlay\}/,
  'generated outputs ImageList should consume the stable overlay renderer',
)
doesNotMatch(
  generatedOutputsSource,
  /renderItemOverlay=\{\(image\) =>/,
  'generated outputs ImageList must not recreate its overlay renderer inline',
)
doesNotMatch(
  generatedOutputsSource,
  /\{watchedFolders\.find\(\(folder\) => String\(folder\.id\) === copyTargetFolderId\)\?\.folder_path\}/,
  'generated outputs copy panel must not scan watched folders inside render output',
)
match(
  outputManagementHelpersSource,
  /artifact\.artifact_type === 'image' \|\| artifact\.artifact_type === 'mask'/,
  'workflow output management should classify final-result masks as generated visual outputs',
)
match(
  outputManagementHelpersSource,
  /\.sort\(compareNewestDateThenId\)/,
  'workflow generated outputs should break same-timestamp ordering ties by stable output id',
)
match(
  outputManagementHelpersSource,
  /\.sort\(compareNewestArtifactDateThenId\)/,
  'workflow technical artifacts should break same-timestamp ordering ties by artifact id',
)
match(
  workflowFinalResultsSectionSource,
  /sourcePortLabel: getFinalResultSourcePortLabel\(finalResult\.source_port_key, finalResult\.artifact_type\)/,
  'workflow final-result cards should keep the source output port in visual overlays',
)
match(
  workflowFinalResultsSectionSource,
  /sourceNodeLabel: getFinalResultSourceNodeLabel\(sourceNodeLabel, finalResult\.source_node_id\)/,
  'workflow final-result cards should keep the source node label in visual overlays',
)
match(
  workflowFinalResultsSectionSource,
  /\[overlayLabel, sourceNodeLabel, sourcePortLabel\]\.filter\(Boolean\)\.join/,
  'workflow final-result file cards should keep the source node and output port in non-visual overlays',
)

console.log('Module workflow output progress contracts verified')
