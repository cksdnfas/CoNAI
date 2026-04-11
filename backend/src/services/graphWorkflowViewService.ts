import { GraphExecutionArtifactModel } from '../models/GraphExecutionArtifact'
import { GraphExecutionFinalResultModel } from '../models/GraphExecutionFinalResult'
import { GraphExecutionModel } from '../models/GraphExecution'
import { GraphWorkflowFolderModel } from '../models/GraphWorkflowFolder'
import { GraphWorkflowModel } from '../models/GraphWorkflow'
import { GraphWorkflowScheduleModel } from '../models/GraphWorkflowSchedule'
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

/** Build folder- or root-scoped browse content for workflow outputs. */
export function buildGraphWorkflowBrowseContent(folderId: number | null) {
  const folderScopeIds = folderId !== null ? GraphWorkflowFolderModel.getSubtreeFolderIds(folderId) : []
  const workflows = folderId !== null
    ? GraphWorkflowModel.findByFolderIds(folderScopeIds, true).map(parseStoredGraphWorkflow)
    : GraphWorkflowModel.findAll(true).map(parseStoredGraphWorkflow)
  const workflowIds = workflows.map((workflow) => workflow.id)
  const schedules = GraphWorkflowScheduleModel.findByWorkflowIds(workflowIds)
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
