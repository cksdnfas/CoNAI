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
    /SELECT \* FROM graph_workflow_versions[\s\S]*ORDER BY version DESC, id DESC/,
    'version summaries should read saved workflow snapshots newest-version first',
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

console.log('✅ Graph workflow route contracts verified')
