import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getGraphExecution, getGraphExecutionPreviews, type GraphExecutionArtifactRecord, type GraphExecutionRecord, type GraphWorkflowExposedInput, type GraphWorkflowFolderRecord, type GraphWorkflowRecord, type GraphWorkflowSummaryRecord, type ModuleDefinitionRecord } from '@/lib/api-module-graph'
import { useI18n } from '@/i18n'
import type { AppSettings } from '@/types/settings'
import { buildNodeArtifactGroups, buildNodeArtifactPreview, buildGraphEditorSnapshot, getModuleNodeDisplayLabel, parseHandleId, type ModuleGraphEdge, type ModuleGraphNode } from './module-graph-shared'
import { deriveWorkflowExposedInputsFromNodes } from './module-graph-workflow-inputs'
import { buildWorkflowValidationIssues } from './module-graph-validation'
import { buildWorkflowExposedInputId } from './module-graph-workflow-input-ids'

type GraphExecutionDetailRecord = Awaited<ReturnType<typeof getGraphExecution>>

/** Build the derived view-model state used by the module graph page without changing page behavior. */
export function useModuleGraphPageViewModel({
  workflowName,
  workflowDescription,
  workflowDebugMode,
  nodes,
  edges,
  workflowView,
  lastSavedSnapshot,
  graphWorkflows,
  selectedGraphId,
  selectedGraphWorkflow,
  graphWorkflowFolders,
  selectedFolderId,
  modules,
  executionList,
  selectedExecutionId,
  selectedNodeId,
  selectedEdgeId,
  executionDetail,
  settings,
  workflowExposedInputs,
  workflowRunInputValues,
}: {
  workflowName: string
  workflowDescription: string
  workflowDebugMode: boolean
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  workflowView: 'browse' | 'edit'
  lastSavedSnapshot: string
  graphWorkflows: GraphWorkflowSummaryRecord[]
  selectedGraphId: number | null
  selectedGraphWorkflow: GraphWorkflowRecord | null
  graphWorkflowFolders: GraphWorkflowFolderRecord[]
  selectedFolderId: number | null
  modules: ModuleDefinitionRecord[]
  executionList: GraphExecutionRecord[]
  selectedExecutionId: number | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
  executionDetail?: GraphExecutionDetailRecord
  settings?: AppSettings | null
  workflowExposedInputs: GraphWorkflowExposedInput[]
  workflowRunInputValues: Record<string, unknown>
}) {
  const { t } = useI18n()

  const nodeDerivedWorkflowExposedInputs = useMemo(
    () => deriveWorkflowExposedInputsFromNodes(nodes),
    [nodes],
  )

  const currentSnapshot = useMemo(
    () =>
      buildGraphEditorSnapshot({
        name: workflowName,
        description: workflowDescription,
        nodes,
        edges,
        workflowMetadata: {
          exposed_inputs: nodeDerivedWorkflowExposedInputs,
          debug_mode: workflowDebugMode,
        },
      }),
    [edges, nodeDerivedWorkflowExposedInputs, nodes, workflowDebugMode, workflowDescription, workflowName],
  )

  const isDirty = currentSnapshot !== lastSavedSnapshot
  const shouldBlockGraphExit = workflowView === 'edit' && isDirty
  // WF-1: 목록에는 그래프 문서가 없다. 선택된 워크플로우의 전체 그래프는 by-id 쿼리 결과에서만 온다.
  const selectedGraphRecord = useMemo(
    () => (selectedGraphId !== null && selectedGraphWorkflow?.id === selectedGraphId ? selectedGraphWorkflow : null),
    [selectedGraphId, selectedGraphWorkflow],
  )
  const selectedFolderRecord = useMemo(() => graphWorkflowFolders.find((folder) => folder.id === selectedFolderId) ?? null, [graphWorkflowFolders, selectedFolderId])
  const moduleDefinitionById = useMemo(() => new Map(modules.map((module) => [module.id, module])), [modules])
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])

  const workflowInputCandidates = useMemo(
    () =>
      nodes.flatMap((node) => {
        const uiFieldByKey = new Map((node.data.module.ui_schema ?? []).map((field) => [field.key, field]))
        const nodeDisplayLabel = getModuleNodeDisplayLabel(node)

        return node.data.module.exposed_inputs.map((port) => {
          const uiField = uiFieldByKey.get(port.key)
          return {
            id: buildWorkflowExposedInputId(node.id, port.key),
            node_id: node.id,
            port_key: port.key,
            label: `${nodeDisplayLabel} · ${port.label}`,
            data_type: port.data_type,
            ui_data_type: uiField?.data_type,
            description: port.description,
            required: port.required,
            placeholder: uiField?.placeholder || port.description || port.label,
            default_value: port.default_value,
            options: uiField?.options,
            module_id: node.data.module.id,
            module_name: nodeDisplayLabel,
          }
        })
      }),
    [nodes],
  )

  const latestExecution = executionList[0] ?? null
  const previewExecutionCandidates = useMemo(
    () => executionList.filter((execution) => execution.status === 'completed').slice(0, 8),
    [executionList],
  )

  // WF-4: 완료 실행 8건을 각각 상세 조회하던 N+1 을 배치 프리뷰 1회로 바꿨다(로그/node_io 제외).
  const previewExecutionIds = useMemo(
    () => previewExecutionCandidates.map((execution) => execution.id),
    [previewExecutionCandidates],
  )
  const previewExecutionBatchQuery = useQuery({
    queryKey: ['module-graph-execution-previews', previewExecutionIds],
    queryFn: () => getGraphExecutionPreviews(previewExecutionIds),
    enabled: previewExecutionIds.length > 0,
    staleTime: 30_000,
  })

  // 최신 완료 실행만 로그/node_io 까지 필요하므로 기존 상세 라우트를 그대로 쓴다.
  // 쿼리 키는 선택 실행 상세와 동일해서 같은 실행을 볼 때는 요청이 합쳐진다.
  const latestCompletedExecutionId = latestExecution?.status === 'completed' ? latestExecution.id : null
  const latestExecutionDetailQuery = useQuery({
    queryKey: ['module-graph-execution-detail', latestCompletedExecutionId],
    queryFn: () => getGraphExecution(latestCompletedExecutionId as number),
    enabled: latestCompletedExecutionId !== null,
    staleTime: 30_000,
  })

  const previewArtifactsByExecution = useMemo(() => {
    const artifactsByExecution = new Map<number, GraphExecutionArtifactRecord[]>()
    for (const artifact of previewExecutionBatchQuery.data?.artifacts ?? []) {
      const bucket = artifactsByExecution.get(artifact.execution_id)
      if (bucket) {
        bucket.push(artifact)
      } else {
        artifactsByExecution.set(artifact.execution_id, [artifact])
      }
    }

    return artifactsByExecution
  }, [previewExecutionBatchQuery.data?.artifacts])

  const latestArtifactPreviewByNode = useMemo(() => {
    const previewByNode = new Map<string, {
      executionArtifactCount: number
      latestArtifactLabel: string | null
      latestArtifactPreviewUrl: string | null
      latestArtifactTextPreview: string | null
      latestArtifactTextValue: string | null
      executionOutputGroups: ReturnType<typeof buildNodeArtifactGroups>
    }>()

    previewExecutionCandidates.forEach((execution) => {
      const executionArtifacts = previewArtifactsByExecution.get(execution.id)
      if (!executionArtifacts) {
        return
      }

      const artifactsByNode = executionArtifacts.reduce<Record<string, GraphExecutionArtifactRecord[]>>((acc, artifact) => {
        if (!acc[artifact.node_id]) {
          acc[artifact.node_id] = []
        }

        acc[artifact.node_id].push(artifact)
        return acc
      }, {})

      Object.entries(artifactsByNode).forEach(([nodeId, nodeArtifacts]) => {
        if (previewByNode.has(nodeId)) {
          return
        }

        const artifactPreview = buildNodeArtifactPreview(nodeArtifacts)
        if (!artifactPreview.latestArtifactLabel && !artifactPreview.latestArtifactPreviewUrl && !artifactPreview.latestArtifactTextPreview) {
          return
        }

        const currentNode = nodeById.get(nodeId)
        previewByNode.set(nodeId, {
          executionArtifactCount: nodeArtifacts.length,
          latestArtifactLabel: artifactPreview.latestArtifactLabel,
          latestArtifactPreviewUrl: artifactPreview.latestArtifactPreviewUrl,
          latestArtifactTextPreview: artifactPreview.latestArtifactTextPreview,
          latestArtifactTextValue: artifactPreview.latestArtifactTextValue,
          executionOutputGroups: buildNodeArtifactGroups(nodeArtifacts, currentNode?.data.module.output_ports ?? []),
        })
      })
    })

    return previewByNode
  }, [nodeById, previewArtifactsByExecution, previewExecutionCandidates])

  const latestExecutionDetail = useMemo(() => {
    const latestPreviewDetail = latestExecutionDetailQuery.data
    if (!latestExecution || !latestPreviewDetail || latestPreviewDetail.execution.id !== latestExecution.id) {
      return null
    }

    return latestPreviewDetail
  }, [latestExecution, latestExecutionDetailQuery.data])
  const latestExecutionDetailIsLoading = latestExecution?.status === 'completed'
    && latestExecutionDetailQuery.isPending === true
  const latestExecutionDetailError = latestExecution?.status === 'completed' && latestExecutionDetailQuery.isError
    ? latestExecutionDetailQuery.error instanceof Error
      ? latestExecutionDetailQuery.error.message
      : t({ ko: '최종 결과 정보를 불러오지 못했어.', en: 'Could not load final result details.' })
    : null

  const selectedExecution = useMemo(
    () => executionList.find((execution) => execution.id === selectedExecutionId) ?? executionDetail?.execution ?? null,
    [executionDetail?.execution, executionList, selectedExecutionId],
  )
  const selectedNode = useMemo(() => selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null, [nodeById, selectedNodeId])
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId) ?? null, [edges, selectedEdgeId])

  const editorValidationIssues = useMemo(
    () =>
      buildWorkflowValidationIssues({
        nodes: nodes.map((node) => ({
          id: node.id,
          module: node.data.module,
          inputValues: node.data.inputValues ?? {},
          disabled: node.data.disabled === true,
        })),
        edges: edges
          .map((edge) => ({
            targetNodeId: edge.target,
            targetPortKey: parseHandleId(edge.targetHandle)?.portKey ?? '',
          }))
          .filter((edge) => edge.targetPortKey.length > 0),
        exposedInputs: nodeDerivedWorkflowExposedInputs,
        settings,
        translate: t,
      }),
    [edges, nodeDerivedWorkflowExposedInputs, nodes, settings, t],
  )

  const selectedWorkflowValidationIssues = useMemo(() => {
    if (!selectedGraphRecord) {
      return []
    }

    return buildWorkflowValidationIssues({
      nodes: selectedGraphRecord.graph.nodes.map((node) => ({
        id: node.id,
        module: moduleDefinitionById.get(node.module_id) ?? null,
        inputValues: node.input_values ?? {},
        disabled: node.disabled === true,
      })),
      edges: selectedGraphRecord.graph.edges.map((edge) => ({
        targetNodeId: edge.target_node_id,
        targetPortKey: edge.target_port_key,
      })),
      exposedInputs: workflowExposedInputs,
      runtimeInputValues: workflowRunInputValues,
      settings,
      translate: t,
    })
  }, [moduleDefinitionById, selectedGraphRecord, settings, t, workflowExposedInputs, workflowRunInputValues])

  const selectedWorkflowCanExecute = selectedWorkflowValidationIssues.every((issue) => issue.severity !== 'error')

  return {
    currentSnapshot,
    isDirty,
    shouldBlockGraphExit,
    selectedGraphRecord,
    selectedFolderRecord,
    moduleDefinitionById,
    workflowInputCandidates,
    latestExecution,
    latestArtifactPreviewByNode,
    latestExecutionDetail,
    latestExecutionDetailIsLoading,
    latestExecutionDetailError,
    selectedExecution,
    selectedNode,
    selectedEdge,
    editorValidationIssues,
    selectedWorkflowValidationIssues,
    selectedWorkflowCanExecute,
  }
}
