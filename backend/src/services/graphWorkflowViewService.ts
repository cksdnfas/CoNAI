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

/** Decorate one execution row with runtime queue state. */
export function decorateGraphExecutionRecord(record: any) {
  return {
    ...record,
    ...GraphWorkflowExecutionQueue.getExecutionRuntimeState(record.id),
  }
}

function summarizeScheduleExecutions(executions: GraphExecutionRecord[]) {
  return executions.reduce((acc, execution) => {
    if (execution.status === 'completed') {
      acc.completed += 1
    }
    if (execution.status === 'queued') {
      acc.queued += 1
    }
    if (execution.status === 'running') {
      acc.running += 1
    }
    if (execution.status === 'failed') {
      acc.failed += 1
    }
    return acc
  }, {
    completed: 0,
    queued: 0,
    running: 0,
    failed: 0,
  })
}

/** Decorate schedule rows with execution progress counters for reservation UI. */
export function decorateGraphWorkflowScheduleRecords(schedules: GraphWorkflowScheduleRecord[]) {
  const scheduleIds = schedules.map((schedule) => schedule.id)
  const executionsByScheduleId = new Map<number, GraphExecutionRecord[]>()

  for (const execution of GraphExecutionModel.findByScheduleIds(scheduleIds, 2000)) {
    if (execution.schedule_id === null || execution.schedule_id === undefined) {
      continue
    }
    const bucket = executionsByScheduleId.get(execution.schedule_id) ?? []
    bucket.push(execution)
    executionsByScheduleId.set(execution.schedule_id, bucket)
  }

  return schedules.map((schedule) => {
    const summary = summarizeScheduleExecutions(executionsByScheduleId.get(schedule.id) ?? [])
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

/** Build folder- or root-scoped browse content for workflow outputs. */
export function buildGraphWorkflowBrowseContent(folderId: number | null) {
  const folderScopeIds = folderId !== null ? GraphWorkflowFolderModel.getSubtreeFolderIds(folderId) : []
  const workflows = folderId !== null
    ? GraphWorkflowModel.findByFolderIds(folderScopeIds, true).map(parseStoredGraphWorkflow)
    : GraphWorkflowModel.findAll(true).map(parseStoredGraphWorkflow)
  const workflowIds = workflows.map((workflow) => workflow.id)
  const schedules = decorateGraphWorkflowScheduleRecords(GraphWorkflowScheduleModel.findByWorkflowIds(workflowIds))
  const executions = GraphExecutionModel.findByWorkflowIds(workflowIds, 300).map(decorateGraphExecutionRecord)
  const executionIds = executions.map((execution) => execution.id)
  const artifacts = GraphExecutionArtifactModel.findByExecutionIds(executionIds)
  const finalResults = GraphExecutionFinalResultModel.findByExecutionIds(executionIds)
  const artifactCountByExecution = artifacts.reduce<Record<number, number>>((acc, artifact) => {
    acc[artifact.execution_id] = (acc[artifact.execution_id] ?? 0) + 1
    return acc
  }, {})
  const finalResultCountByExecution = finalResults.reduce<Record<number, number>>((acc, result) => {
    acc[result.execution_id] = (acc[result.execution_id] ?? 0) + 1
    return acc
  }, {})
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
