import { getUserSettingsDb } from '../database/userSettingsDb'
import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowFolderModel } from '../models/GraphWorkflowFolder'
import { GraphWorkflowModel, getGraphWorkflowRevision } from '../models/GraphWorkflow'
import { GraphWorkflowScheduleModel } from '../models/GraphWorkflowSchedule'
import type {
  GraphExecutionRecord,
  GraphWorkflowNameRecord,
  GraphWorkflowScheduleRecord,
} from '../types/moduleGraph'
import { GraphWorkflowExecutionQueue } from './graphWorkflowExecutionQueue'

/**
 * Execution columns used by browse/reservation surfaces.
 *
 * WF-2: `execution_plan` 은 노드 실행 계획 JSON 이라 목록 응답에 들어갈 이유가 없다.
 * 단일 실행 상세(`GET /executions/:id`)와 워크플로우별 실행 목록(`GET /:id/executions`)은
 * 종전대로 전체 컬럼을 유지하므로 실행 계획 UI 는 그대로 동작한다.
 */
const GRAPH_EXECUTION_LIST_COLUMNS = `
      id,
      graph_workflow_id,
      graph_version,
      status,
      trigger_type,
      schedule_id,
      started_at,
      completed_at,
      failed_node_id,
      error_message,
      created_date,
      updated_date`

/**
 * 예약 스냅샷 최대 수명.
 *
 * 1차 게이트는 리비전이지만 SQLite `CURRENT_TIMESTAMP` 는 초 단위라 같은 초 안의 재전이를
 * 놓칠 수 있다. 예약 탭 폴링(2초)보다 짧은 상한을 둬서 N명이 동시에 폴링해도 계산은
 * 이 창당 1회로 수렴하면서 체감 지연은 종전과 같게 유지한다.
 */
const RESERVATION_SNAPSHOT_MAX_AGE_MS = 1_500

type ParsedGraphDocument = {
  nodes: unknown[]
  edges: unknown[]
  [key: string]: unknown
}

function parseGraphDocument(value: string | null | undefined): ParsedGraphDocument {
  if (!value) {
    return { nodes: [], edges: [] }
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { nodes: [], edges: [] }
    }

    const document = parsed as Record<string, unknown>
    return {
      ...document,
      nodes: Array.isArray(document.nodes) ? document.nodes : [],
      edges: Array.isArray(document.edges) ? document.edges : [],
    }
  } catch {
    return { nodes: [], edges: [] }
  }
}

/**
 * Parse one stored workflow row into a response-safe graph document shape.
 *
 * WF-1: 예전에는 `graph_json` 원문 문자열과 파싱된 `graph` 객체를 **둘 다** 응답에 실어
 * 그래프 하나당 페이로드가 2배였다. 이제 원문은 응답에서 제거하고 파싱본만 남긴다.
 * 이 함수는 전체 그래프를 내려주는 유일한 경로(`GET /api/graph-workflows/:id`) 전용이다.
 */
export function parseStoredGraphWorkflow(record: any) {
  const { graph_json: graphJson, ...rest } = record ?? {}
  const graph = parseGraphDocument(graphJson)
  const finalResultNodeCount = typeof rest.id === 'number'
    ? GraphWorkflowModel.countFinalResultNodesByWorkflowIds([rest.id]).get(rest.id) ?? 0
    : 0

  return {
    ...rest,
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    final_result_node_count: finalResultNodeCount,
    graph,
  }
}

/** Decorate execution rows with runtime queue state in one queue pass. */
export function decorateGraphExecutionRecords(records: any[]) {
  const runtimeStateById = GraphWorkflowExecutionQueue.getExecutionRuntimeStateMap(records.map((record) => record.id))
  return records.map((record) => ({
    ...record,
    ...(runtimeStateById.get(record.id) ?? { queue_position: null, cancel_requested: false }),
  }))
}

/** Decorate one execution row with runtime queue state. */
export function decorateGraphExecutionRecord(record: any) {
  return decorateGraphExecutionRecords([record])[0]
}

/** Decorate schedule rows with execution progress counters for reservation UI. */
export function decorateGraphWorkflowScheduleRecords(schedules: GraphWorkflowScheduleRecord[]) {
  const scheduleIds = schedules.map((schedule) => schedule.id)
  const countsByScheduleId = GraphExecutionModel.countStatusesByScheduleIds(scheduleIds)

  return schedules.map((schedule) => {
    const summary = countsByScheduleId.get(schedule.id) ?? {
      completed: 0,
      queued: 0,
      running: 0,
      failed: 0,
      cancelled: 0,
    }
    const reservedRunCount = summary.completed + summary.queued + summary.running
    const remainingRunCount = schedule.max_run_count === null || schedule.max_run_count === undefined
      ? null
      : Math.max(schedule.max_run_count - reservedRunCount, 0)

    return {
      ...schedule,
      completed_run_count: summary.completed,
      queued_run_count: summary.queued,
      running_run_count: summary.running,
      failed_run_count: summary.failed,
      reserved_run_count: reservedRunCount,
      remaining_run_count: remainingRunCount,
    }
  })
}

/** Read browse/reservation execution rows with an explicit column list (no `execution_plan`). */
function findGraphExecutionListRows(workflowIds: number[], limit: number): GraphExecutionRecord[] {
  if (workflowIds.length === 0) {
    return []
  }

  const db = getUserSettingsDb()
  const placeholders = workflowIds.map(() => '?').join(', ')
  return db.prepare(`
    SELECT ${GRAPH_EXECUTION_LIST_COLUMNS}
    FROM graph_executions
    WHERE graph_workflow_id IN (${placeholders})
    ORDER BY created_date DESC, id DESC
    LIMIT ?
  `).all(...workflowIds, limit) as GraphExecutionRecord[]
}

type GraphWorkflowBrowseContentOptions = {
  includeOutputs?: boolean
}

/** Build folder- or root-scoped browse content for workflow outputs. */
export function buildGraphWorkflowBrowseContent(folderId: number | null, options: GraphWorkflowBrowseContentOptions = {}) {
  const folderScopeIds = folderId !== null ? GraphWorkflowFolderModel.getSubtreeFolderIds(folderId) : []
  // WF-1: 브라우즈 응답도 그래프 문서를 싣지 않는다. 전체 그래프가 필요한 화면은 by-id 로 받는다.
  const workflows = folderId !== null
    ? GraphWorkflowModel.findSummariesByFolderIds(folderScopeIds, true)
    : GraphWorkflowModel.findAllSummaries(true)
  const workflowIds = workflows.map((workflow) => workflow.id)
  const schedules = decorateGraphWorkflowScheduleRecords(GraphWorkflowScheduleModel.findByWorkflowIds(workflowIds))
  const executions = decorateGraphExecutionRecords(findGraphExecutionListRows(workflowIds, 300))
  const executionIds = executions.map((execution) => execution.id)
  const includeOutputs = options.includeOutputs !== false
  const artifacts = includeOutputs ? GraphExecutionArtifactModel.findByExecutionIds(executionIds) : []
  const finalResults = includeOutputs ? GraphExecutionFinalResultModel.findByExecutionIds(executionIds) : []
  const artifactCountMap = includeOutputs
    ? null
    : GraphExecutionArtifactModel.countByExecutionIds(executionIds)
  const finalResultCountMap = includeOutputs
    ? null
    : GraphExecutionFinalResultModel.countByExecutionIds(executionIds)
  const artifactCountByExecution = includeOutputs
    ? artifacts.reduce<Record<number, number>>((acc, artifact) => {
      acc[artifact.execution_id] = (acc[artifact.execution_id] ?? 0) + 1
      return acc
    }, {})
    : Object.fromEntries(artifactCountMap ?? [])
  const finalResultCountByExecution = includeOutputs
    ? finalResults.reduce<Record<number, number>>((acc, result) => {
      acc[result.execution_id] = (acc[result.execution_id] ?? 0) + 1
      return acc
    }, {})
    : Object.fromEntries(finalResultCountMap ?? [])
  const emptyExecutions = executions.filter((execution) => (
    (artifactCountByExecution[execution.id] ?? 0) === 0
    && (finalResultCountByExecution[execution.id] ?? 0) === 0
  ))

  return {
    scope: {
      folder_id: folderId,
      folder_ids: folderId !== null ? folderScopeIds : null,
      workflow_count: workflows.length,
      execution_count: executions.length,
      schedule_count: schedules.length,
      artifact_count: artifacts.length,
      final_result_count: finalResults.length,
      empty_execution_count: emptyExecutions.length,
    },
    workflows,
    schedules,
    executions,
    artifacts,
    final_results: finalResults,
    empty_executions: emptyExecutions,
  }
}

type GraphWorkflowReservationSnapshot = {
  revision: string
  builtAt: number
  workflows: GraphWorkflowNameRecord[]
  schedules: ReturnType<typeof decorateGraphWorkflowScheduleRecords>
  executionRows: GraphExecutionRecord[]
  emptyExecutionIds: Set<number>
}

let reservationSnapshot: GraphWorkflowReservationSnapshot | null = null

/**
 * Cheap change probe for reservation data.
 *
 * 워크플로우 쓰기는 이미 인메모리 리비전(`getGraphWorkflowRevision`)이 잡아주고,
 * 실행/일정 테이블은 행 수·최대 id·최신 updated_date 만 읽어 변화를 감지한다.
 * 두 테이블은 보존 정책(`graphWorkflowOutputRetentionService`)이 수백 행 규모로 유지하므로
 * 이 프로브는 사실상 상수 비용이다. 프로브가 변화를 놓치더라도
 * `RESERVATION_SNAPSHOT_MAX_AGE_MS` 상한이 정합을 보장한다.
 */
function readReservationDataRevision() {
  const db = getUserSettingsDb()
  const executions = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(MAX(id), 0) AS max_id, COALESCE(MAX(updated_date), '') AS latest
    FROM graph_executions
  `).get() as { total: number; max_id: number; latest: string }
  const schedules = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(MAX(id), 0) AS max_id, COALESCE(MAX(updated_date), '') AS latest
    FROM graph_workflow_schedules
  `).get() as { total: number; max_id: number; latest: string }

  return [
    getGraphWorkflowRevision(),
    executions.total, executions.max_id, executions.latest,
    schedules.total, schedules.max_id, schedules.latest,
  ].join('|')
}

function buildReservationSnapshot(revision: string): GraphWorkflowReservationSnapshot {
  const workflows = GraphWorkflowModel.findNameEntries(true)
  const workflowIds = workflows.map((workflow) => workflow.id)
  const schedules = decorateGraphWorkflowScheduleRecords(GraphWorkflowScheduleModel.findByWorkflowIds(workflowIds))
  const executionRows = findGraphExecutionListRows(workflowIds, 300)
  const executionIds = executionRows.map((execution) => execution.id)
  const artifactCountByExecution = GraphExecutionArtifactModel.countByExecutionIds(executionIds)
  const finalResultCountByExecution = GraphExecutionFinalResultModel.countByExecutionIds(executionIds)
  const emptyExecutionIds = new Set(
    executionRows
      .filter((execution) => (
        (artifactCountByExecution.get(execution.id) ?? 0) === 0
        && (finalResultCountByExecution.get(execution.id) ?? 0) === 0
      ))
      .map((execution) => execution.id),
  )

  return { revision, builtAt: Date.now(), workflows, schedules, executionRows, emptyExecutionIds }
}

/** Reset the shared reservation snapshot (tests and contract verification). */
export function resetGraphWorkflowReservationSnapshot() {
  reservationSnapshot = null
}

/**
 * Build the reservation-tab payload (WF-2).
 *
 * 종전 예약 탭은 `browse-content` 전체 덤프를 2초마다 받아서 워크플로우 그래프 전체(~0.9MB)를
 * 매번 되풀이 전송했다. 여기서는 워크플로우를 `{ id, name }` 라벨 맵으로 줄이고, 일정과 실행만
 * 명시 컬럼으로 담는다. DB 파생 부분은 리비전이 같으면 재계산하지 않고 공유 스냅샷을 돌려주며,
 * 큐 순번·취소요청 같은 인메모리 런타임 상태는 스냅샷 밖에서 매 요청 새로 얹는다.
 */
export function buildGraphWorkflowReservationContent() {
  const revision = readReservationDataRevision()
  const now = Date.now()
  const isReusable = reservationSnapshot !== null
    && reservationSnapshot.revision === revision
    && now - reservationSnapshot.builtAt < RESERVATION_SNAPSHOT_MAX_AGE_MS

  if (!isReusable) {
    reservationSnapshot = buildReservationSnapshot(revision)
  }

  const snapshot = reservationSnapshot as GraphWorkflowReservationSnapshot
  const executions = decorateGraphExecutionRecords(snapshot.executionRows)
  const emptyExecutions = executions.filter((execution) => snapshot.emptyExecutionIds.has(execution.id))

  return {
    scope: {
      revision: snapshot.revision,
      workflow_count: snapshot.workflows.length,
      schedule_count: snapshot.schedules.length,
      execution_count: executions.length,
      empty_execution_count: emptyExecutions.length,
    },
    workflows: snapshot.workflows,
    schedules: snapshot.schedules,
    executions,
    empty_executions: emptyExecutions,
  }
}
