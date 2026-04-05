import { useCallback, useState } from 'react'
import {
  cancelGraphExecution,
  createGraphWorkflow,
  executeGraphNode,
  executeGraphWorkflow,
  updateGraphWorkflow,
  type GraphExecutionRecord,
  type GraphWorkflowExposedInput,
  type GraphWorkflowRecord,
} from '@/lib/api'
import { buildGraphEditorSnapshot, buildGraphPayload, type ModuleGraphEdge, type ModuleGraphNode } from './module-graph-shared'

/** Own graph save and execution actions for the module-graph page. */
export function useModuleGraphExecutionActions({
  nodes,
  edges,
  workflowName,
  workflowDescription,
  workflowExposedInputs,
  draftWorkflowFolderId,
  selectedGraphId,
  selectedGraphRecord,
  selectedNode,
  selectedExecution,
  selectedWorkflowValidationIssues,
  workflowRunInputValues,
  isDirty,
  onWorkflowNameResolved,
  onGraphSelected,
  onExecutionSelected,
  onNodeSelected,
  onEdgeCleared,
  onSnapshotSaved,
  refetchGraphWorkflows,
  refetchGraphExecutions,
  refetchExecutionDetail,
  showSnackbar,
}: {
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  workflowName: string
  workflowDescription: string
  workflowExposedInputs: GraphWorkflowExposedInput[]
  draftWorkflowFolderId: number | null
  selectedGraphId: number | null
  selectedGraphRecord: GraphWorkflowRecord | null
  selectedNode: ModuleGraphNode | null
  selectedExecution: GraphExecutionRecord | null
  selectedWorkflowValidationIssues: Array<{ severity: 'error' | 'warning' | 'info'; nodeLabel: string; title: string }>
  workflowRunInputValues: Record<string, unknown>
  isDirty: boolean
  onWorkflowNameResolved: (name: string) => void
  onGraphSelected: (graphId: number) => void
  onExecutionSelected: (executionId: number | null) => void
  onNodeSelected: (nodeId: string) => void
  onEdgeCleared: () => void
  onSnapshotSaved: (snapshot: string) => void
  refetchGraphWorkflows: () => Promise<unknown>
  refetchGraphExecutions: () => Promise<unknown>
  refetchExecutionDetail: () => Promise<unknown>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const [isSavingGraph, setIsSavingGraph] = useState(false)
  const [executingGraphId, setExecutingGraphId] = useState<number | null>(null)
  const [cancellingExecutionId, setCancellingExecutionId] = useState<number | null>(null)

  /** Persist the current in-editor graph and return the saved workflow identity. */
  const persistCurrentGraph = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true

    if (nodes.length === 0) {
      if (!silent) {
        showSnackbar({ message: '저장할 노드를 먼저 하나 이상 배치해줘.', tone: 'error' })
      }
      return null
    }

    const resolvedName = resolveWorkflowDisplayName(workflowName, selectedGraphRecord?.name)
    const graph = buildGraphPayload(nodes, edges, {
      exposed_inputs: workflowExposedInputs,
    })
    const description = workflowDescription.trim() || undefined
    const payload = {
      name: resolvedName,
      description,
      graph,
      folder_id: draftWorkflowFolderId,
    }

    let graphId: number
    let created: boolean

    if (selectedGraphId !== null) {
      await updateGraphWorkflow(selectedGraphId, payload)
      graphId = selectedGraphId
      created = false
    } else {
      const createdResult = await createGraphWorkflow(payload)
      graphId = createdResult.id
      created = true
    }

    const savedSnapshot = buildGraphEditorSnapshot({
      name: resolvedName,
      description: workflowDescription,
      nodes,
      edges,
      workflowMetadata: {
        exposed_inputs: workflowExposedInputs,
      },
    })

    if (resolvedName !== workflowName) {
      onWorkflowNameResolved(resolvedName)
    }
    if (selectedGraphId !== graphId) {
      onGraphSelected(graphId)
    }
    onExecutionSelected(null)
    onSnapshotSaved(savedSnapshot)
    await refetchGraphWorkflows()

    return {
      graphId,
      created,
      name: resolvedName,
    }
  }, [draftWorkflowFolderId, edges, nodes, onExecutionSelected, onGraphSelected, onSnapshotSaved, onWorkflowNameResolved, refetchGraphWorkflows, selectedGraphId, selectedGraphRecord?.name, showSnackbar, workflowDescription, workflowExposedInputs, workflowName])

  /** Save the current graph workflow draft and show one user-facing result message. */
  const handleSaveGraph = useCallback(async () => {
    if (isSavingGraph) {
      return
    }

    try {
      setIsSavingGraph(true)
      const saveResult = await persistCurrentGraph()
      if (!saveResult) {
        return
      }

      showSnackbar({
        message: saveResult.created
          ? `새 그래프 워크플로우를 저장했어. (${saveResult.name})`
          : `현재 그래프를 업데이트 저장했어. (${saveResult.name})`,
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '그래프 저장에 실패했어.', tone: 'error' })
    } finally {
      setIsSavingGraph(false)
    }
  }, [isSavingGraph, persistCurrentGraph, showSnackbar])

  /** Queue a full workflow execution for one saved graph. */
  const handleExecuteGraph = useCallback(async (graphId: number, inputValues?: Record<string, unknown>) => {
    if (executingGraphId !== null) {
      return
    }

    try {
      setExecutingGraphId(graphId)
      onGraphSelected(graphId)
      const result = await executeGraphWorkflow(graphId, inputValues ? { input_values: inputValues } : undefined)
      onExecutionSelected(result.executionId)
      await refetchGraphExecutions()
      showSnackbar({
        message: `워크플로우 실행 요청을 등록했어. 실행 #${result.executionId}가 백그라운드 큐에서 처리돼.`,
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '워크플로우 실행에 실패했어.', tone: 'error' })
    } finally {
      setExecutingGraphId(null)
    }
  }, [executingGraphId, onExecutionSelected, onGraphSelected, refetchGraphExecutions, showSnackbar])

  /** Queue execution up to one selected node, auto-saving the graph first when needed. */
  const handleExecuteNodeById = useCallback(async (nodeId: string, forceRerun = false) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) {
      showSnackbar({ message: '실행할 노드를 찾지 못했어.', tone: 'error' })
      return
    }

    if (executingGraphId !== null) {
      return
    }

    try {
      let graphId = selectedGraphId
      let autoSaved = false

      if (selectedGraphId === null || isDirty) {
        const saveResult = await persistCurrentGraph({ silent: true })
        if (!saveResult) {
          showSnackbar({ message: '선택 노드를 실행하려면 현재 그래프를 먼저 저장할 수 있어야 해.', tone: 'error' })
          return
        }

        graphId = saveResult.graphId
        autoSaved = true
      }

      if (graphId === null) {
        showSnackbar({ message: '실행할 그래프를 준비하지 못했어.', tone: 'error' })
        return
      }

      onNodeSelected(nodeId)
      onEdgeCleared()
      setExecutingGraphId(graphId)
      const payload = Object.keys(workflowRunInputValues).length > 0 || forceRerun
        ? {
            ...(Object.keys(workflowRunInputValues).length > 0 ? { input_values: workflowRunInputValues } : {}),
            ...(forceRerun ? { force_rerun: true } : {}),
          }
        : undefined
      const result = await executeGraphNode(graphId, nodeId, payload)
      onExecutionSelected(result.executionId)
      await refetchGraphExecutions()
      showSnackbar({
        message: forceRerun
          ? `${autoSaved ? '현재 그래프를 저장한 뒤 ' : ''}강제 재실행 요청을 등록했어. 실행 #${result.executionId}는 ${node.data.module.name}까지 캐시 없이 다시 처리해.`
          : `${autoSaved ? '현재 그래프를 저장한 뒤 ' : ''}선택 노드 실행 요청을 등록했어. 실행 #${result.executionId}가 ${node.data.module.name}까지 필요한 upstream만 처리해.`,
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '선택 노드 실행에 실패했어.', tone: 'error' })
    } finally {
      setExecutingGraphId(null)
    }
  }, [executingGraphId, isDirty, nodes, onEdgeCleared, onExecutionSelected, onNodeSelected, persistCurrentGraph, refetchGraphExecutions, selectedGraphId, showSnackbar, workflowRunInputValues])

  /** Execute the currently selected node, optionally forcing a full rerun path. */
  const handleExecuteSelectedNode = useCallback(async (forceRerun = false) => {
    if (!selectedNode) {
      showSnackbar({ message: '먼저 실행할 노드를 하나 선택해줘.', tone: 'error' })
      return
    }

    await handleExecuteNodeById(selectedNode.id, forceRerun)
  }, [handleExecuteNodeById, selectedNode, showSnackbar])

  /** Run the currently selected saved workflow after validation and required-input checks. */
  const handleRunSelectedWorkflow = useCallback(async () => {
    if (selectedGraphRecord === null) {
      showSnackbar({ message: '먼저 워크플로우를 하나 선택해줘.', tone: 'error' })
      return
    }

    const blockingValidationIssue = selectedWorkflowValidationIssues.find((issue) => issue.severity === 'error')
    if (blockingValidationIssue) {
      showSnackbar({ message: `${blockingValidationIssue.nodeLabel}: ${blockingValidationIssue.title}`, tone: 'error' })
      return
    }

    const exposedInputs = selectedGraphRecord.graph.metadata?.exposed_inputs ?? []
    const missingRequiredInput = exposedInputs.find((inputDefinition) => {
      if (!inputDefinition.required) {
        return false
      }

      const value = workflowRunInputValues[inputDefinition.id]
      return value === undefined || value === null || value === ''
    })

    if (missingRequiredInput) {
      showSnackbar({ message: `필수 입력 '${missingRequiredInput.label}' 값을 먼저 넣어줘.`, tone: 'error' })
      return
    }

    await handleExecuteGraph(selectedGraphRecord.id, workflowRunInputValues)
  }, [handleExecuteGraph, selectedGraphRecord, selectedWorkflowValidationIssues, showSnackbar, workflowRunInputValues])

  /** Rerun the active workflow, auto-saving the editor draft first when necessary. */
  const handleRerunSelectedGraph = useCallback(async () => {
    if (executingGraphId !== null) {
      return
    }

    let graphId = selectedGraphId

    if (selectedGraphId === null || isDirty) {
      try {
        const saveResult = await persistCurrentGraph({ silent: true })
        if (!saveResult) {
          showSnackbar({ message: '재실행하려면 현재 그래프를 먼저 저장할 수 있어야 해.', tone: 'error' })
          return
        }

        graphId = saveResult.graphId
      } catch (error) {
        showSnackbar({ message: error instanceof Error ? error.message : '재실행 전에 그래프 저장에 실패했어.', tone: 'error' })
        return
      }
    }

    if (graphId === null) {
      showSnackbar({ message: '먼저 그래프를 하나 불러와줘.', tone: 'error' })
      return
    }

    await handleExecuteGraph(graphId)
  }, [executingGraphId, handleExecuteGraph, isDirty, persistCurrentGraph, selectedGraphId, showSnackbar])

  /** Cancel the currently selected execution and refresh both list and detail views. */
  const handleCancelSelectedExecution = useCallback(async () => {
    if (!selectedExecutionIdValue(selectedExecution)) {
      showSnackbar({ message: '먼저 실행 하나를 선택해줘.', tone: 'error' })
      return
    }

    const executionId = selectedExecutionIdValue(selectedExecution) as number

    try {
      setCancellingExecutionId(executionId)
      const result = await cancelGraphExecution(executionId)
      await Promise.all([refetchGraphExecutions(), refetchExecutionDetail()])
      showSnackbar({ message: result.message, tone: result.success ? 'info' : 'error' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '실행 취소에 실패했어.', tone: 'error' })
    } finally {
      setCancellingExecutionId(null)
    }
  }, [refetchExecutionDetail, refetchGraphExecutions, selectedExecution, showSnackbar])

  /** Retry one failed or cancelled execution by rerunning its parent workflow. */
  const handleRetrySelectedExecution = useCallback(async () => {
    if (!selectedExecution || (selectedExecution.status !== 'failed' && selectedExecution.status !== 'cancelled')) {
      showSnackbar({ message: '실패하거나 취소된 실행을 먼저 선택해줘.', tone: 'error' })
      return
    }

    await handleExecuteGraph(selectedExecution.graph_workflow_id)
  }, [handleExecuteGraph, selectedExecution, showSnackbar])

  return {
    isSavingGraph,
    executingGraphId,
    cancellingExecutionId,
    handleSaveGraph,
    handleExecuteNodeById,
    handleExecuteSelectedNode,
    handleRunSelectedWorkflow,
    handleRerunSelectedGraph,
    handleCancelSelectedExecution,
    handleRetrySelectedExecution,
  }
}

function resolveWorkflowDisplayName(name: string, fallbackName?: string | null) {
  const trimmedName = name.trim()
  if (trimmedName.length > 0) {
    return trimmedName
  }

  const trimmedFallbackName = fallbackName?.trim()
  return trimmedFallbackName && trimmedFallbackName.length > 0 ? trimmedFallbackName : 'Workflow Draft'
}

function selectedExecutionIdValue(selectedExecution: GraphExecutionRecord | null) {
  return selectedExecution?.id ?? null
}
