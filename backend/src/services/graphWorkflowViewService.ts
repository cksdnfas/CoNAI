import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowFolderModel } from '../models/GraphWorkflowFolder'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { GraphWorkflowScheduleModel } from '../models/GraphWorkflowSchedule'
import type { GraphExecutionRecord, GraphWorkflowScheduleRecord } from '../types/moduleGraph'
import { GraphWorkflowExecutionQueue } from './graphWorkflowExecutionQueue'

/** Parse one stored workflow row into a response-safe graph document shape. */
export function parseStoredGraphWorkflow(record: any) {
  return {
    ...record,
    graph: record.graph_json ? JSON.parse(record.graph_json) : { nodes: [], edges: [] },
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

type GraphWorkflowBrowseContentOptions = {
  includeOutputs?: boolean
}

/** Build folder- or root-scoped browse content for workflow outputs. */
export function buildGraphWorkflowBrowseContent(folderId: number | null, options: GraphWorkflowBrowseContentOptions = {}) {
  const folderScopeIds = folderId !== null ? GraphWorkflowFolderModel.getSubtreeFolderIds(folderId) : []
  const workflows = folderId !== null
    ? GraphWorkflowModel.findByFolderIds(folderScopeIds, true).map(parseStoredGraphWorkflow)
    : GraphWorkflowModel.findAll(true).map(parseStoredGraphWorkflow)
  const workflowIds = workflows.map((workflow) => workflow.id)
  const schedules = decorateGraphWorkflowScheduleRecords(GraphWorkflowScheduleModel.findByWorkflowIds(workflowIds))
  const executions = decorateGraphExecutionRecords(GraphExecutionModel.findByWorkflowIds(workflowIds, 300))
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
