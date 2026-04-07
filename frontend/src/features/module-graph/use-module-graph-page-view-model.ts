import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { getGraphExecution, type GraphExecutionArtifactRecord, type GraphExecutionRecord, type GraphWorkflowFolderRecord, type GraphWorkflowRecord, type ModuleDefinitionRecord } from '@/lib/api'
import type { AppSettings } from '@/types/settings'
import type { WorkflowValidationIssue } from './components/workflow-validation-panel'
import { buildNodeArtifactGroups, buildNodeArtifactPreview, buildGraphEditorSnapshot, parseHandleId, type ModuleGraphEdge, type ModuleGraphNode } from './module-graph-shared'
import { deriveWorkflowExposedInputsFromNodes } from './module-graph-workflow-inputs'
import { buildWorkflowExposedInputId, buildWorkflowValidationIssues } from './module-graph-validation'

type GraphExecutionDetailRecord = Awaited<ReturnType<typeof getGraphExecution>>

/** Build the derived view-model state used by the module graph page without changing page behavior. */
export function useModuleGraphPageViewModel({
  workflowName,
  workflowDescription,
  nodes,
  edges,
  workflowView,
  lastSavedSnapshot,
  graphWorkflows,
  selectedGraphId,
  graphWorkflowFolders,
  selectedFolderId,
  modules,
  executionList,
  selectedExecutionId,
  selectedNodeId,
  selectedEdgeId,
  executionDetail,
  settings,
  workflowRunInputValues,
}: {
  workflowName: string
  workflowDescription: string
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  workflowView: 'browse' | 'edit'
  lastSavedSnapshot: string
  graphWorkflows: GraphWorkflowRecord[]
  selectedGraphId: number | null
  graphWorkflowFolders: GraphWorkflowFolderRecord[]
  selectedFolderId: number | null
  modules: ModuleDefinitionRecord[]
  executionList: GraphExecutionRecord[]
  selectedExecutionId: number | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
  executionDetail?: GraphExecutionDetailRecord
  settings?: AppSettings | null
  workflowRunInputValues: Record<string, unknown>
}) {
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
        },
      }),
    [edges, nodeDerivedWorkflowExposedInputs, nodes, workflowDescription, workflowName],
  )

  const isDirty = currentSnapshot !== lastSavedSnapshot
  const shouldBlockGraphExit = workflowView === 'edit' && isDirty
  const selectedGraphRecord = useMemo(() => graphWorkflows.find((graph) => graph.id === selectedGraphId) ?? null, [graphWorkflows, selectedGraphId])
  const selectedFolderRecord = useMemo(() => graphWorkflowFolders.find((folder) => folder.id === selectedFolderId) ?? null, [graphWorkflowFolders, selectedFolderId])
  const moduleDefinitionById = useMemo(() => new Map(modules.map((module) => [module.id, module])), [modules])

  const workflowInputCandidates = useMemo(
    () =>
      nodes.flatMap((node) =>
        node.data.module.exposed_inputs.map((port) => {
          const uiField = node.data.module.ui_schema?.find((field) => field.key === port.key)

          return {
            id: buildWorkflowExposedInputId(node.id, port.key),
            node_id: node.id,
            port_key: port.key,
            label: `${node.data.module.name} · ${port.label}`,
            data_type: port.data_type,
            ui_data_type: uiField?.data_type,
            description: port.description,
            required: port.required,
            placeholder: uiField?.placeholder || port.description || port.label,
            default_value: port.default_value,
            options: uiField?.options,
            module_id: node.data.module.id,
            module_name: node.data.module.name,
          }
        }),
      ),
    [nodes],
  )

  const latestExecution = executionList[0] ?? null
  const previewExecutionCandidates = useMemo(
    () => executionList.filter((execution) => execution.status === 'completed').slice(0, 8),
    [executionList],
  )

  const previewExecutionDetailQueries = useQueries({
    queries: previewExecutionCandidates.map((execution) => ({
      queryKey: ['module-graph-preview-execution-detail', execution.id],
      queryFn: () => getGraphExecution(execution.id),
      staleTime: 30_000,
    })),
  })

  const latestArtifactPreviewByNode = useMemo(() => {
    const previewByNode = new Map<string, {
      executionArtifactCount: number
      latestArtifactLabel: string | null
      latestArtifactPreviewUrl: string | null
      latestArtifactTextPreview: string | null
      executionOutputGroups: ReturnType<typeof buildNodeArtifactGroups>
    }>()

    previewExecutionCandidates.forEach((execution, index) => {
      const detail = previewExecutionDetailQueries[index]?.data
      if (!detail || detail.execution.id !== execution.id) {
        return
      }

      const artifactsByNode = detail.artifacts.reduce<Record<string, GraphExecutionArtifactRecord[]>>((acc, artifact) => {
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

        const currentNode = nodes.find((node) => node.id === nodeId)
        previewByNode.set(nodeId, {
          executionArtifactCount: nodeArtifacts.length,
          latestArtifactLabel: artifactPreview.latestArtifactLabel,
          latestArtifactPreviewUrl: artifactPreview.latestArtifactPreviewUrl,
          latestArtifactTextPreview: artifactPreview.latestArtifactTextPreview,
          executionOutputGroups: buildNodeArtifactGroups(nodeArtifacts, currentNode?.data.module.output_ports ?? []),
        })
      })
    })

    return previewByNode
  }, [nodes, previewExecutionCandidates, previewExecutionDetailQueries])

  const latestExecutionDetail = useMemo(() => {
    const latestPreviewDetail = previewExecutionDetailQueries[0]?.data
    if (!latestExecution || !latestPreviewDetail || latestPreviewDetail.execution.id !== latestExecution.id) {
      return null
    }

    return latestPreviewDetail
  }, [latestExecution, previewExecutionDetailQueries])

  const selectedExecution = useMemo(
    () => executionList.find((execution) => execution.id === selectedExecutionId) ?? executionDetail?.execution ?? null,
    [executionDetail?.execution, executionList, selectedExecutionId],
  )
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId])
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId) ?? null, [edges, selectedEdgeId])

  const editorValidationIssues = useMemo(
    () =>
      buildWorkflowValidationIssues({
        nodes: nodes.map((node) => ({
          id: node.id,
          module: node.data.module,
          inputValues: node.data.inputValues ?? {},
        })),
        edges: edges
          .map((edge) => ({
            targetNodeId: edge.target,
            targetPortKey: parseHandleId(edge.targetHandle)?.portKey ?? '',
          }))
          .filter((edge) => edge.targetPortKey.length > 0),
        exposedInputs: nodeDerivedWorkflowExposedInputs,
        settings,
      }),
    [edges, nodeDerivedWorkflowExposedInputs, nodes, settings],
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
      })),
      edges: selectedGraphRecord.graph.edges.map((edge) => ({
        targetNodeId: edge.target_node_id,
        targetPortKey: edge.target_port_key,
      })),
      exposedInputs: selectedGraphRecord.graph.metadata?.exposed_inputs ?? [],
      runtimeInputValues: workflowRunInputValues,
      settings,
    })
  }, [moduleDefinitionById, selectedGraphRecord, settings, workflowRunInputValues])

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
    selectedExecution,
    selectedNode,
    selectedEdge,
    editorValidationIssues,
    selectedWorkflowValidationIssues,
    selectedWorkflowCanExecute,
  }
}
