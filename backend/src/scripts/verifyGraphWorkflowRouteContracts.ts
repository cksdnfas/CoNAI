import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Response } from 'express'
import {
  MAX_BULK_SCHEDULE_ENQUEUE_COUNT,
  parseBoundedScheduleEnqueueCount,
  parseGraphExecutionInputValues,
  parseGraphRouteInteger,
  parseOptionalGraphFolderId,
  parseOptionalTrimmedString,
  parseRequiredGraphRouteId,
  parseScheduleEnqueueCount,
  parseScheduleFailurePolicy,
  parseScheduleInputValues,
  parseScheduleMaxRunCount,
  parseScheduleRunEnqueueCount,
  parseScheduleStatus,
  parseScheduleType,
  sendGraphRouteNotFound,
} from '../routes/graph-workflows/route-helpers'

class CapturedResponse {
  statusCode: number | undefined
  payload: unknown

  status(code: number) {
    this.statusCode = code
    return this
  }

  json(payload: unknown) {
    this.payload = payload
    return this
  }
}

function source(path: string) {
  return readFileSync(`src/${path}`, 'utf8')
}

function createResponse() {
  return new CapturedResponse() as unknown as Response & CapturedResponse
}

function verifyGraphRouteIntegerParsing() {
  assert.equal(parseGraphRouteInteger('42'), 42)
  assert.equal(parseGraphRouteInteger(['42', '99']), 42)
  assert.equal(parseGraphRouteInteger('12px'), 12)
  assert.equal(parseGraphRouteInteger('0x10'), 16)
  assert.equal(Number.isNaN(parseGraphRouteInteger('not-a-number')), true)
  assert.throws(() => parseGraphRouteInteger(undefined), /Route parameter is required/)
  assert.throws(() => parseGraphRouteInteger([]), /Route parameter is required/)
}

function verifyOptionalGraphFolderIdParsing() {
  assert.deepEqual(parseOptionalGraphFolderId(undefined), { ok: true, value: null })
  assert.deepEqual(parseOptionalGraphFolderId(null), { ok: true, value: null })
  assert.deepEqual(parseOptionalGraphFolderId(''), { ok: true, value: null })
  assert.deepEqual(parseOptionalGraphFolderId('7'), { ok: true, value: 7 })
  assert.deepEqual(parseOptionalGraphFolderId(7), { ok: true, value: 7 })
  assert.deepEqual(parseOptionalGraphFolderId('1.5'), { ok: false, value: null })
  assert.deepEqual(parseOptionalGraphFolderId('0'), { ok: false, value: null })
  assert.deepEqual(parseOptionalGraphFolderId('-1'), { ok: false, value: null })
  assert.deepEqual(parseOptionalGraphFolderId('not-a-number'), { ok: false, value: null })
  assert.deepEqual(parseOptionalGraphFolderId(['7']), { ok: false, value: null })
  assert.deepEqual(parseOptionalGraphFolderId(true), { ok: false, value: null })
}

function verifyRequiredIdBadRequestShape() {
  const res = createResponse()
  const result = parseRequiredGraphRouteId(res, 'not-a-number', 'Invalid folder ID')

  assert.equal(result, null)
  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.payload, {
    success: false,
    error: 'Invalid folder ID',
  })
}

function verifyNotFoundShape() {
  const res = createResponse()
  const result = sendGraphRouteNotFound(res, 'Graph workflow folder not found')

  assert.equal(result, null)
  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.payload, {
    success: false,
    error: 'Graph workflow folder not found',
  })
}

function verifyScheduleEnumParsers() {
  assert.equal(parseScheduleType('once'), 'once')
  assert.equal(parseScheduleType('interval'), 'interval')
  assert.equal(parseScheduleType('daily'), 'daily')
  assert.equal(parseScheduleType('weekly'), null)
  assert.equal(parseScheduleType(undefined), null)

  assert.equal(parseScheduleStatus('active'), 'active')
  assert.equal(parseScheduleStatus('paused'), 'paused')
  assert.equal(parseScheduleStatus('error_stopped'), 'error_stopped')
  assert.equal(parseScheduleStatus('overlap_stopped'), 'overlap_stopped')
  assert.equal(parseScheduleStatus('completed'), 'completed')
  assert.equal(parseScheduleStatus('running'), null)

  assert.equal(parseScheduleFailurePolicy('stop'), 'stop')
  assert.equal(parseScheduleFailurePolicy('continue'), 'continue')
  assert.equal(parseScheduleFailurePolicy('retry'), null)
}

function verifyScheduleValueParsers() {
  assert.equal(parseOptionalTrimmedString('  ready  '), 'ready')
  assert.equal(parseOptionalTrimmedString('   '), null)
  assert.equal(parseOptionalTrimmedString(123), null)

  assert.deepEqual(parseScheduleInputValues({ prompt: 'a' }), { prompt: 'a' })
  assert.equal(parseScheduleInputValues([]), null)
  assert.equal(parseScheduleInputValues(null), null)

  assert.deepEqual(parseGraphExecutionInputValues({ prompt: 'a' }), { prompt: 'a' })
  assert.deepEqual(parseGraphExecutionInputValues(['legacy-array-input']), ['legacy-array-input'])
  assert.equal(parseGraphExecutionInputValues(null), undefined)

  assert.equal(parseScheduleMaxRunCount(undefined), null)
  assert.equal(parseScheduleMaxRunCount(null), null)
  assert.equal(parseScheduleMaxRunCount(''), null)
  assert.equal(parseScheduleMaxRunCount(-1), null)
  assert.equal(parseScheduleMaxRunCount('-1'), null)
  assert.equal(parseScheduleMaxRunCount('5'), 5)
  assert.equal(parseScheduleMaxRunCount(5), 5)
  assert.equal(parseScheduleMaxRunCount(0), null)
  assert.equal(parseScheduleMaxRunCount('-2'), null)
  assert.equal(parseScheduleMaxRunCount('1.5'), null)
}

function verifyScheduleEnqueueCountParsers() {
  assert.equal(MAX_BULK_SCHEDULE_ENQUEUE_COUNT, 100)

  assert.equal(parseBoundedScheduleEnqueueCount(undefined, 7, 1), 7)
  assert.equal(parseBoundedScheduleEnqueueCount(null, 7, 1), 7)
  assert.equal(parseBoundedScheduleEnqueueCount('', 7, 1), 7)
  assert.equal(parseBoundedScheduleEnqueueCount('not-a-number', 7, 1), null)
  assert.equal(parseBoundedScheduleEnqueueCount('1.5', 7, 1), null)
  assert.equal(parseBoundedScheduleEnqueueCount(0, 7, 1), null)
  assert.equal(parseBoundedScheduleEnqueueCount(1, 7, 1), 1)
  assert.equal(parseBoundedScheduleEnqueueCount(MAX_BULK_SCHEDULE_ENQUEUE_COUNT, 7, 1), MAX_BULK_SCHEDULE_ENQUEUE_COUNT)
  assert.equal(parseBoundedScheduleEnqueueCount(MAX_BULK_SCHEDULE_ENQUEUE_COUNT + 1, 7, 1), null)

  assert.equal(parseScheduleEnqueueCount(undefined), 0)
  assert.equal(parseScheduleEnqueueCount(0), 0)
  assert.equal(parseScheduleEnqueueCount(100), 100)
  assert.equal(parseScheduleEnqueueCount(101), null)
  assert.equal(parseScheduleEnqueueCount(-1), null)

  assert.equal(parseScheduleRunEnqueueCount(undefined), 1)
  assert.equal(parseScheduleRunEnqueueCount(1), 1)
  assert.equal(parseScheduleRunEnqueueCount(100), 100)
  assert.equal(parseScheduleRunEnqueueCount(101), null)
  assert.equal(parseScheduleRunEnqueueCount(0), null)
}

function verifyExecutionListNewestTieBreaker() {
  const graphExecutionModelSource = source('models/GraphExecution.ts')

  assert.match(
    graphExecutionModelSource,
    /static findByWorkflow\([\s\S]*ORDER BY created_date DESC, id DESC[\s\S]*LIMIT \?/,
    'workflow execution list must break same-timestamp ties by id so latest-result selection is deterministic',
  )
}

function verifyExecutionDetailNewestTieBreakers() {
  const artifactModelSource = source('models/GraphExecutionArtifact.ts')
  const finalResultModelSource = source('models/GraphExecutionFinalResult.ts')

  assert.match(
    artifactModelSource,
    /static findByExecution\(executionId: number\)[\s\S]*ORDER BY created_date DESC, id DESC/,
    'single-execution artifact details must use the same newest-first id tie breaker as browse/output lists',
  )
  assert.match(
    finalResultModelSource,
    /static findByExecution\(executionId: number\)[\s\S]*ORDER BY fr\.created_date DESC, fr\.id DESC/,
    'single-execution final-result details must use newest-first id tie breaker for rapid same-timestamp outputs',
  )
}

function verifyWorkflowVersionSummaryRoute() {
  const workflowRoutesSource = source('routes/graph-workflows/workflow-routes.ts')
  const graphWorkflowModelSource = source('models/GraphWorkflow.ts')
  const moduleGraphTypesSource = source('types/moduleGraph.ts')
  const versionsRouteIndex = workflowRoutesSource.indexOf("router.get('/:id/versions'")
  const singleWorkflowRouteIndex = workflowRoutesSource.indexOf("router.get('/:id'")

  assert.ok(versionsRouteIndex >= 0, 'workflow CRUD routes should expose saved workflow version summaries')
  assert.ok(
    versionsRouteIndex < singleWorkflowRouteIndex,
    'workflow version summaries route must be registered before the generic workflow id route',
  )
  assert.match(
    workflowRoutesSource,
    /GraphWorkflowModel\.findVersionSummaries\(id, Number\.isInteger\(limit\) \? limit : 12\)/,
    'workflow version route should use the model summary reader with a safe default limit',
  )
  assert.match(
    graphWorkflowModelSource,
    /static findVersionSummaries\(workflowId: number, limit = 12\): GraphWorkflowVersionSummaryRecord\[\]/,
    'GraphWorkflowModel should expose compact version summaries for operator review',
  )
  assert.match(
    graphWorkflowModelSource,
    /FROM graph_workflow_versions[\s\S]*ORDER BY version DESC, id DESC/,
    'version summaries should read saved workflow snapshots newest-version first',
  )
  // WF-5: 스냅샷마다 `graph_json` 을 JS 로 두 번 파싱하던 경로를 SQL 카운트로 대체했다.
  assert.doesNotMatch(
    graphWorkflowModelSource,
    /SELECT \* FROM graph_workflow_versions/,
    'version summaries must not hydrate whole snapshot rows: the graph document must stay in SQLite',
  )
  assert.match(
    graphWorkflowModelSource,
    /GRAPH_WORKFLOW_VERSION_SUMMARY_COLUMNS[\s\S]*json_array_length\(graph_json, '\$\.nodes'\)[\s\S]*json_array_length\(graph_json, '\$\.edges'\)[\s\S]*json_array_length\(graph_json, '\$\.metadata\.exposed_inputs'\)/,
    'version summary counts should be computed by SQLite JSON1 instead of JSON.parse per snapshot',
  )
  assert.match(
    graphWorkflowModelSource,
    /node_delta: previousRecord \? nodeCount - previousNodeCount : 0/,
    'version summaries should include graph structure deltas against the previous snapshot',
  )
  assert.ok(
    moduleGraphTypesSource.includes('export interface GraphWorkflowVersionSummaryRecord'),
    'backend module graph types should define the version summary response shape',
  )
}

/**
 * WF-1/WF-2 계약: 목록·예약 응답은 그래프 문서를 절대 담지 않는다.
 * 전체 그래프는 `GET /api/graph-workflows/:id` 한 곳으로만 나간다.
 */
function verifyWorkflowListSummaryProjection() {
  const workflowRoutesSource = source('routes/graph-workflows/workflow-routes.ts')
  const graphWorkflowModelSource = source('models/GraphWorkflow.ts')
  const viewServiceSource = source('services/graphWorkflowViewService.ts')
  const moduleGraphTypesSource = source('types/moduleGraph.ts')
  const namesRouteIndex = workflowRoutesSource.indexOf("router.get('/names'")
  const reservationsRouteIndex = workflowRoutesSource.indexOf("router.get('/reservations'")
  const singleWorkflowRouteIndex = workflowRoutesSource.indexOf("router.get('/:id'")

  assert.match(
    workflowRoutesSource,
    /const workflows = GraphWorkflowModel\.findAllSummaries\(activeOnly\)/,
    'the saved workflow list route must return the summary projection, not parsed graph documents',
  )
  assert.doesNotMatch(
    workflowRoutesSource,
    /GraphWorkflowModel\.findAll\(activeOnly\)\.map\(parseStoredGraphWorkflow\)/,
    'the saved workflow list route must not hydrate every stored graph document',
  )
  assert.ok(namesRouteIndex >= 0, 'workflow CRUD routes should expose a name-only label source')
  assert.ok(reservationsRouteIndex >= 0, 'workflow CRUD routes should expose the reservation snapshot route')
  assert.ok(
    namesRouteIndex < singleWorkflowRouteIndex && reservationsRouteIndex < singleWorkflowRouteIndex,
    'name and reservation routes must be registered before the generic workflow id route',
  )
  assert.match(
    graphWorkflowModelSource,
    /GRAPH_WORKFLOW_SUMMARY_COLUMNS[\s\S]*json_array_length\(graph_json, '\$\.nodes'\)[\s\S]*json_array_length\(graph_json, '\$\.edges'\)/,
    'workflow list summaries should compute node/edge counts in SQL instead of parsing graph documents',
  )
  assert.doesNotMatch(
    graphWorkflowModelSource,
    /GRAPH_WORKFLOW_SUMMARY_COLUMNS = `[^`]*\n\s+graph_json\b/,
    'the workflow summary projection must not select the graph document column',
  )
  assert.match(
    graphWorkflowModelSource,
    /static countFinalResultNodesByWorkflowIds\(workflowIds: number\[\]\): Map<number, number>[\s\S]*json_each\(/,
    'final-result node counts should be computed with SQLite json_each so list rows stay graph-free',
  )
  assert.match(
    viewServiceSource,
    /export function parseStoredGraphWorkflow[\s\S]*const \{ graph_json: graphJson, \.\.\.rest \} = record/,
    'the single-workflow response must strip the raw graph_json string instead of returning it twice',
  )
  assert.match(
    viewServiceSource,
    /GraphWorkflowModel\.findSummariesByFolderIds\(folderScopeIds, true\)[\s\S]*GraphWorkflowModel\.findAllSummaries\(true\)/,
    'browse content must list workflow summaries rather than parsed graph documents',
  )
  assert.match(
    viewServiceSource,
    /export function buildGraphWorkflowReservationContent\(\)[\s\S]*reservationSnapshot\.revision === revision/,
    'the reservation payload must reuse a shared snapshot while the data revision is unchanged',
  )
  assert.doesNotMatch(
    viewServiceSource,
    /GRAPH_EXECUTION_LIST_COLUMNS = `[^`]*execution_plan/,
    'browse/reservation execution rows must not carry the execution plan document',
  )
  assert.ok(
    moduleGraphTypesSource.includes('export interface GraphWorkflowSummaryRecord')
      && moduleGraphTypesSource.includes('node_count')
      && moduleGraphTypesSource.includes('final_result_node_count'),
    'backend module graph types should define the workflow list summary shape',
  )
}

/** WF-3 계약: ComfyUI 워크플로우 목록도 `workflow_json` 을 싣지 않는다. */
function verifyComfyWorkflowListSummaryProjection() {
  const workflowModelSource = source('models/Workflow.ts')
  const crudRoutesSource = source('routes/workflows/crud.routes.ts')

  assert.match(
    workflowModelSource,
    /static findAllSummaries\(activeOnly: boolean = false\): WorkflowSummaryRecord\[\]/,
    'the ComfyUI workflow model should expose a list projection without the workflow document',
  )
  assert.match(
    workflowModelSource,
    /export type WorkflowSummaryRecord = Omit<WorkflowRecord, 'workflow_json'>/,
    'the ComfyUI workflow list projection type must exclude workflow_json',
  )
  assert.match(
    crudRoutesSource,
    /const workflows = WorkflowModel\.findAllSummaries\(activeOnly\)/,
    'GET /api/workflows must use the summary projection so the graph document stays out of list responses',
  )
}

/** WF-4 계약: 실행 미리보기는 배치 1회로 받고 로그/node_io 는 포함하지 않는다. */
function verifyExecutionPreviewBatchRoute() {
  const executionRoutesSource = source('routes/graph-workflows/execution-routes.ts')
  const previewRouteIndex = executionRoutesSource.indexOf("router.get('/executions/previews'")
  const executionDetailRouteIndex = executionRoutesSource.indexOf("router.get('/executions/:executionId'")

  assert.ok(previewRouteIndex >= 0, 'execution routes should expose a batch artifact preview endpoint')
  assert.ok(
    previewRouteIndex < executionDetailRouteIndex,
    'the batch preview route must be registered before the generic execution id route',
  )
  assert.doesNotMatch(
    executionRoutesSource.slice(previewRouteIndex, executionDetailRouteIndex),
    /GraphExecutionLogModel|GraphExecutionNodeIoModel/,
    'batch previews must not hydrate execution logs or node IO rows',
  )
}

function verifyWorkflowRuntimeHealthRoute() {
  const workflowRoutesSource = source('routes/graph-workflows/workflow-routes.ts')
  const graphExecutionModelSource = source('models/GraphExecution.ts')
  const graphWorkflowScheduleModelSource = source('models/GraphWorkflowSchedule.ts')
  const graphWorkflowExecutionQueueSource = source('services/graphWorkflowExecutionQueue.ts')
  const retentionServiceSource = source('services/graphWorkflowOutputRetentionService.ts')
  const moduleGraphTypesSource = source('types/moduleGraph.ts')
  const runtimeHealthRouteIndex = workflowRoutesSource.indexOf("router.get('/:id/runtime-health'")
  const singleWorkflowRouteIndex = workflowRoutesSource.indexOf("router.get('/:id'")

  assert.ok(runtimeHealthRouteIndex >= 0, 'workflow CRUD routes should expose runtime health summaries')
  assert.ok(
    runtimeHealthRouteIndex < singleWorkflowRouteIndex,
    'workflow runtime health route must be registered before the generic workflow id route',
  )
  assert.match(
    workflowRoutesSource,
    /GraphExecutionModel\.summarizeWorkflowRuntime\(id\)/,
    'runtime health route should use the execution model summary instead of hydrating execution rows',
  )
  assert.match(
    workflowRoutesSource,
    /GraphWorkflowExecutionQueue\.getWorkflowRuntimeQueueState\(id\)/,
    'runtime health route should include in-process queue retry and cancellation state',
  )
  assert.match(
    workflowRoutesSource,
    /GraphWorkflowScheduleModel\.summarizeRuntimePolicyByWorkflowId\(id\)/,
    'runtime health route should include autorun retry/failure policy counts',
  )
  assert.match(
    workflowRoutesSource,
    /getGraphWorkflowOutputRetentionState\(id\)/,
    'runtime health route should include retention state without pruning inline',
  )
  assert.match(
    graphExecutionModelSource,
    /static summarizeWorkflowRuntime\(workflowId: number\): GraphWorkflowRuntimeExecutionSummary[\s\S]*COALESCE\(SUM\(CASE WHEN status = 'queued'/,
    'GraphExecutionModel should summarize queue and telemetry counts in SQL',
  )
  assert.match(
    graphWorkflowScheduleModelSource,
    /static summarizeRuntimePolicyByWorkflowId\(workflowId: number\): GraphWorkflowScheduleRuntimePolicySummary[\s\S]*failure_policy/,
    'GraphWorkflowScheduleModel should summarize retry policy and stopped schedule state',
  )
  assert.ok(
    graphWorkflowExecutionQueueSource.includes('private static lastStartupRecovery')
      && graphWorkflowExecutionQueueSource.includes('static getWorkflowRuntimeQueueState(workflowId: number)')
      && graphWorkflowExecutionQueueSource.includes('retry_timer_pending: Boolean(this.processRetryTimer)'),
    'GraphWorkflowExecutionQueue should expose startup recovery and retry timer state',
  )
  assert.ok(
    retentionServiceSource.includes('export function getGraphWorkflowOutputRetentionState(workflowId: number)')
      && retentionServiceSource.includes('pendingRetentionPrunes.has(workflowId)'),
    'graph workflow retention service should expose lightweight pending prune state',
  )
  assert.ok(
    moduleGraphTypesSource.includes('export interface GraphWorkflowRuntimeHealthRecord')
      && moduleGraphTypesSource.includes('retry_policy')
      && moduleGraphTypesSource.includes('running_not_in_process_count'),
    'backend module graph types should define the runtime health response shape',
  )
}

function verifyWorkflowImportExportRoutes() {
  const workflowRoutesSource = source('routes/graph-workflows/workflow-routes.ts')
  const apiModuleGraphSource = readFileSync('../frontend/src/lib/api-module-graph.ts', 'utf8')
  const sidebarSource = readFileSync('../frontend/src/features/module-graph/components/module-graph-workflow-list-sidebar.tsx', 'utf8')
  const exportRouteIndex = workflowRoutesSource.indexOf("router.get('/:id/export'")
  const importRouteIndex = workflowRoutesSource.indexOf("router.post('/import'")
  const singleWorkflowRouteIndex = workflowRoutesSource.indexOf("router.get('/:id'")

  assert.ok(exportRouteIndex >= 0, 'workflow CRUD routes should expose saved workflow export')
  assert.ok(importRouteIndex >= 0, 'workflow CRUD routes should expose saved workflow import')
  assert.ok(
    exportRouteIndex < singleWorkflowRouteIndex,
    'workflow export route must be registered before the generic workflow id route',
  )
  assert.ok(
    importRouteIndex < singleWorkflowRouteIndex,
    'workflow import route must be registered before the generic workflow id route',
  )
  assert.ok(
    workflowRoutesSource.includes("schema: 'conai.graph-workflow.export'")
      && workflowRoutesSource.includes('createPlaceholderModule')
      && workflowRoutesSource.includes('placeholder_module_count'),
    'workflow import/export should use a portable schema and create placeholder modules for missing definitions',
  )
  assert.ok(
    apiModuleGraphSource.includes('export async function exportGraphWorkflow')
      && apiModuleGraphSource.includes('export async function importGraphWorkflow'),
    'frontend API client should expose workflow export/import helpers',
  )
  assert.ok(
    sidebarSource.includes('워크플로우 내보내기')
      && sidebarSource.includes('워크플로우 가져오기'),
    'workflow sidebar should expose import/export controls',
  )
}

verifyGraphRouteIntegerParsing()
verifyOptionalGraphFolderIdParsing()
verifyRequiredIdBadRequestShape()
verifyNotFoundShape()
verifyScheduleEnumParsers()
verifyScheduleValueParsers()
verifyScheduleEnqueueCountParsers()
verifyExecutionListNewestTieBreaker()
verifyExecutionDetailNewestTieBreakers()
verifyWorkflowVersionSummaryRoute()
verifyWorkflowRuntimeHealthRoute()
verifyWorkflowImportExportRoutes()
verifyWorkflowListSummaryProjection()
verifyComfyWorkflowListSummaryProjection()
verifyExecutionPreviewBatchRoute()

console.log('✅ Graph workflow route contracts verified')
