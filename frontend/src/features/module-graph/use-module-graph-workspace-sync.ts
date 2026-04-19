import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useRef } from 'react'
import {
  getGraphExecution,
  type GraphExecutionArtifactRecord,
  type GraphExecutionRecord,
  type GraphWorkflowExposedInput,
} from '@/lib/api'
import {
  buildNodeArtifactGroups,
  buildNodeArtifactPreview,
  getNodeExecutionStatus,
  parseHandleId,
  type ModuleGraphEdge,
  type ModuleGraphNode,
} from './module-graph-shared'
import { buildWorkflowRunInputDefaults, deriveWorkflowExposedInputsFromNodes } from './module-graph-workflow-inputs'

type GraphExecutionDetailRecord = Awaited<ReturnType<typeof getGraphExecution>>

type NodeArtifactPreviewRecord = {
  executionArtifactCount: number
  latestArtifactLabel: string | null
  latestArtifactPreviewUrl: string | null
  latestArtifactTextPreview: string | null
  latestArtifactTextValue: string | null
  executionOutputGroups: ReturnType<typeof buildNodeArtifactGroups>
}

/** Keep module-graph workspace selection, input defaults, feedback, and node previews in sync. */
export function useModuleGraphWorkspaceSync({
  selectedGraphId,
  nodes,
  executionList,
  selectedExecutionId,
  executionDetail,
  latestArtifactPreviewByNode,
  edges,
  setSelectedExecutionId,
  setWorkflowRunInputValues,
  setWorkflowExposedInputs,
  setNodes,
  showSnackbar,
}: {
  selectedGraphId: number | null
  nodes: ModuleGraphNode[]
  executionList: GraphExecutionRecord[]
  selectedExecutionId: number | null
  executionDetail: GraphExecutionDetailRecord | undefined
  latestArtifactPreviewByNode: Map<string, NodeArtifactPreviewRecord>
  edges: ModuleGraphEdge[]
  setSelectedExecutionId: (executionId: number | null) => void
  setWorkflowRunInputValues: Dispatch<SetStateAction<Record<string, unknown>>>
  setWorkflowExposedInputs: Dispatch<SetStateAction<GraphWorkflowExposedInput[]>>
  setNodes: Dispatch<SetStateAction<ModuleGraphNode[]>>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const previousExecutionStatusesRef = useRef<Record<number, GraphExecutionRecord['status']>>({})
  const lastNodePreviewSyncSignatureRef = useRef('')
  const lastAutoSelectedGraphIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (selectedGraphId === null || executionList.length === 0) {
      lastAutoSelectedGraphIdRef.current = null
      return
    }

    const hasSelectedExecution = selectedExecutionId !== null && executionList.some((execution) => execution.id === selectedExecutionId)
    if (hasSelectedExecution) {
      lastAutoSelectedGraphIdRef.current = selectedGraphId
      return
    }

    if (selectedExecutionId === null && lastAutoSelectedGraphIdRef.current === selectedGraphId) {
      return
    }

    lastAutoSelectedGraphIdRef.current = selectedGraphId
    setSelectedExecutionId(executionList[0].id)
  }, [executionList, selectedExecutionId, selectedGraphId, setSelectedExecutionId])

  useEffect(() => {
    const exposedInputs = deriveWorkflowExposedInputsFromNodes(nodes)
    const inputDefaults = buildWorkflowRunInputDefaults(exposedInputs)

    setWorkflowExposedInputs(exposedInputs)
    setWorkflowRunInputValues((currentValues) => {
      const nextValues = exposedInputs.reduce<Record<string, unknown>>((acc, inputDefinition) => {
        if (currentValues[inputDefinition.id] !== undefined) {
          acc[inputDefinition.id] = currentValues[inputDefinition.id]
          return acc
        }

        if (inputDefaults[inputDefinition.id] !== undefined) {
          acc[inputDefinition.id] = inputDefaults[inputDefinition.id]
        }
        return acc
      }, {})

      return nextValues
    })
  }, [nodes, setWorkflowExposedInputs, setWorkflowRunInputValues])

  useEffect(() => {
    const previousStatuses = previousExecutionStatusesRef.current

    for (const execution of executionList) {
      const previousStatus = previousStatuses[execution.id]
      if (!previousStatus) {
        continue
      }

      if ((previousStatus === 'queued' || previousStatus === 'running') && execution.status !== previousStatus) {
        if (execution.status === 'completed') {
          showSnackbar({ message: `실행 #${execution.id} 완료.`, tone: 'info' })
        } else if (execution.status === 'failed') {
          showSnackbar({ message: `실행 #${execution.id} 실패.`, tone: 'error' })
        } else if (execution.status === 'cancelled') {
          showSnackbar({ message: `실행 #${execution.id} 취소됨.`, tone: 'info' })
        }
      }
    }

    previousExecutionStatusesRef.current = executionList.reduce<Record<number, GraphExecutionRecord['status']>>((acc, execution) => {
      acc[execution.id] = execution.status
      return acc
    }, {})
  }, [executionList, showSnackbar])

  useEffect(() => {
    const connectedInputMap = new Map<string, Set<string>>()
    const connectedOutputMap = new Map<string, Set<string>>()

    for (const edge of edges) {
      const sourceHandle = parseHandleId(edge.sourceHandle)
      const targetHandle = parseHandleId(edge.targetHandle)

      if (sourceHandle?.portKey) {
        const current = connectedOutputMap.get(edge.source) ?? new Set<string>()
        current.add(sourceHandle.portKey)
        connectedOutputMap.set(edge.source, current)
      }

      if (targetHandle?.portKey) {
        const current = connectedInputMap.get(edge.target) ?? new Set<string>()
        current.add(targetHandle.portKey)
        connectedInputMap.set(edge.target, current)
      }
    }

    const fallbackPreviewSignature = Array.from(latestArtifactPreviewByNode.entries())
      .sort(([leftNodeId], [rightNodeId]) => leftNodeId.localeCompare(rightNodeId))
      .map(([nodeId, preview]) => `${nodeId}:${preview.executionArtifactCount}:${preview.latestArtifactLabel ?? ''}:${preview.latestArtifactPreviewUrl ?? ''}:${preview.latestArtifactTextPreview ?? ''}:${preview.latestArtifactTextValue ?? ''}:${preview.executionOutputGroups.map((group) => `${group.portKey}:${group.artifactCount}:${group.latestArtifactLabel ?? ''}:${group.latestArtifactPreviewUrl ?? ''}:${group.latestArtifactTextPreview ?? ''}:${group.latestArtifactTextValue ?? ''}`).join(',')}`)
      .join('|')
    const edgeSignature = edges
      .map((edge) => `${edge.id}:${edge.source}:${edge.sourceHandle ?? ''}:${edge.target}:${edge.targetHandle ?? ''}`)
      .join('|')

    if (!executionDetail) {
      const syncSignature = `no-execution|${edgeSignature}|${fallbackPreviewSignature}`
      if (lastNodePreviewSyncSignatureRef.current === syncSignature) {
        return
      }

      lastNodePreviewSyncSignatureRef.current = syncSignature
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const fallbackPreview = latestArtifactPreviewByNode.get(node.id)

          return {
            ...node,
            data: {
              ...node.data,
              executionStatus: fallbackPreview ? 'completed' : 'idle',
              executionArtifactCount: fallbackPreview?.executionArtifactCount ?? 0,
              latestArtifactLabel: fallbackPreview?.latestArtifactLabel ?? null,
              latestArtifactPreviewUrl: fallbackPreview?.latestArtifactPreviewUrl ?? null,
              latestArtifactTextPreview: fallbackPreview?.latestArtifactTextPreview ?? null,
              executionReuseState: null,
              executionOutputGroups: fallbackPreview?.executionOutputGroups ?? [],
              connectedInputKeys: Array.from(connectedInputMap.get(node.id) ?? []),
              connectedOutputKeys: Array.from(connectedOutputMap.get(node.id) ?? []),
            },
          }
        }),
      )
      return
    }

    const executionPlan = executionDetail.execution.execution_plan
      ? JSON.parse(executionDetail.execution.execution_plan) as { orderedNodeIds?: string[]; reusedNodeIds?: string[] }
      : { orderedNodeIds: [] }

    const orderedNodeIds = executionPlan.orderedNodeIds ?? []
    const reusedNodeIds = new Set(executionPlan.reusedNodeIds ?? [])
    const artifactsByNode = executionDetail.artifacts.reduce<Record<string, GraphExecutionArtifactRecord[]>>((acc, artifact) => {
      if (!acc[artifact.node_id]) {
        acc[artifact.node_id] = []
      }

      acc[artifact.node_id].push(artifact)
      return acc
    }, {})
    const artifactNodeIds = new Set(Object.keys(artifactsByNode))
    const executionArtifactSignature = executionDetail.artifacts
      .map((artifact) => `${artifact.id}:${artifact.node_id}:${artifact.port_key}:${artifact.artifact_type}:${artifact.storage_path ?? ''}:${artifact.created_date}`)
      .join('|')
    const executionPlanSignature = `${executionDetail.execution.id}:${executionDetail.execution.status}:${executionDetail.execution.failed_node_id ?? ''}:${executionDetail.execution.updated_date}:${orderedNodeIds.join(',')}:${Array.from(reusedNodeIds).join(',')}`
    const syncSignature = `${executionPlanSignature}|${executionArtifactSignature}|${edgeSignature}|${fallbackPreviewSignature}`
    if (lastNodePreviewSyncSignatureRef.current === syncSignature) {
      return
    }

    lastNodePreviewSyncSignatureRef.current = syncSignature
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const nodeArtifacts = artifactsByNode[node.id] ?? []
        const selectedArtifactPreview = buildNodeArtifactPreview(nodeArtifacts)
        const fallbackPreview = latestArtifactPreviewByNode.get(node.id)
        const artifactPreview = nodeArtifacts.length > 0
          ? selectedArtifactPreview
          : {
              latestArtifactLabel: fallbackPreview?.latestArtifactLabel ?? null,
              latestArtifactPreviewUrl: fallbackPreview?.latestArtifactPreviewUrl ?? null,
              latestArtifactTextPreview: fallbackPreview?.latestArtifactTextPreview ?? null,
              latestArtifactTextValue: fallbackPreview?.latestArtifactTextValue ?? null,
            }
        const selectedExecutionStatus = getNodeExecutionStatus({
          nodeId: node.id,
          orderedNodeIds,
          artifactNodeIds,
          executionStatus: executionDetail.execution.status,
          failedNodeId: executionDetail.execution.failed_node_id,
        })
        const executionStatus = nodeArtifacts.length > 0 || orderedNodeIds.includes(node.id)
          ? selectedExecutionStatus
          : fallbackPreview
            ? 'completed'
            : 'idle'

        const executionOutputGroups = nodeArtifacts.length > 0
          ? buildNodeArtifactGroups(nodeArtifacts, node.data.module.output_ports ?? [])
          : (fallbackPreview?.executionOutputGroups ?? [])

        return {
          ...node,
          data: {
            ...node.data,
            executionStatus,
            executionArtifactCount: nodeArtifacts.length > 0 ? nodeArtifacts.length : (fallbackPreview?.executionArtifactCount ?? 0),
            latestArtifactLabel: artifactPreview.latestArtifactLabel,
            latestArtifactPreviewUrl: artifactPreview.latestArtifactPreviewUrl,
            latestArtifactTextPreview: artifactPreview.latestArtifactTextPreview,
            latestArtifactTextValue: artifactPreview.latestArtifactTextValue,
            executionReuseState: reusedNodeIds.has(node.id) ? 'reused' : null,
            executionOutputGroups,
            connectedInputKeys: Array.from(connectedInputMap.get(node.id) ?? []),
            connectedOutputKeys: Array.from(connectedOutputMap.get(node.id) ?? []),
          },
        }
      }),
    )
  }, [edges, executionDetail, latestArtifactPreviewByNode, setNodes])
}
