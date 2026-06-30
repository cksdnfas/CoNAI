import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useRef } from 'react'
import {
  getGraphExecution,
  type GraphExecutionArtifactRecord,
  type GraphExecutionRecord,
  type GraphWorkflowExposedInput,
} from '@/lib/api-module-graph'
import {
  buildNodeArtifactGroups,
  buildNodeArtifactPreview,
  buildNodeOrderIndex,
  buildPlannedNodeExecutionOrder,
  getModuleOperationKey,
  getNodeExecutionStatus,
  parseMetadataValue,
  parseHandleId,
  type ModuleGraphConditionalOutputState,
  type ModuleGraphEdge,
  type ModuleGraphExecutionSkipReason,
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

function parseRecord(value?: string | null) {
  const parsed = parseMetadataValue(value ?? null)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
}

function readBranchPortFromMetadata(metadata: Record<string, unknown> | null) {
  const selectedBranch = typeof metadata?.selectedBranch === 'string' ? metadata.selectedBranch : null
  if (selectedBranch === 'true') return 'true_value'
  if (selectedBranch === 'false') return 'false_value'
  return null
}

function writeConditionalOutputState(
  outputStatesByNode: Record<string, Record<string, ModuleGraphConditionalOutputState>>,
  nodeId: string | null | undefined,
  portKey: string | null | undefined,
  state: ModuleGraphConditionalOutputState,
) {
  if (!nodeId || !portKey) {
    return
  }

  outputStatesByNode[nodeId] = outputStatesByNode[nodeId] ?? {}
  if (state === 'active' || outputStatesByNode[nodeId][portKey] !== 'active') {
    outputStatesByNode[nodeId][portKey] = state
  }
}

function readSkippedNodeReason(details: Record<string, unknown> | null): ModuleGraphExecutionSkipReason {
  const disabledInputs = Array.isArray(details?.disabledInputs) ? details.disabledInputs : []
  const inputReasons = disabledInputs
    .filter((input): input is Record<string, unknown> => Boolean(input) && typeof input === 'object' && !Array.isArray(input))
    .map((input) => input.reason)

  if (inputReasons.includes('source_node_skipped')) {
    return 'source-node-skipped'
  }

  if (inputReasons.includes('source_output_disabled')) {
    return 'source-output-disabled'
  }

  if (inputReasons.includes('inactive_if_branch')) {
    return 'inactive-branch'
  }

  return 'unknown'
}

/** Derive skipped-node reasons from execution logs so graph cards can explain non-running paths. */
export function buildSkippedNodeReasonMap(executionDetail: GraphExecutionDetailRecord | undefined) {
  const skippedNodeReasons = new Map<string, ModuleGraphExecutionSkipReason>()
  if (!executionDetail) {
    return skippedNodeReasons
  }

  for (const log of executionDetail.logs ?? []) {
    if (!log.node_id) {
      continue
    }

    if (log.event_type === 'node_skipped_disabled') {
      skippedNodeReasons.set(log.node_id, 'disabled')
      continue
    }

    if (log.event_type === 'node_skipped_inactive_branch') {
      skippedNodeReasons.set(log.node_id, readSkippedNodeReason(parseRecord(log.details)))
    }
  }

  return skippedNodeReasons
}

/** Derive post-run conditional output states from IF branch artifacts and skip logs. */
export function buildConditionalOutputStates(executionDetail: GraphExecutionDetailRecord | undefined) {
  const outputStatesByNode: Record<string, Record<string, ModuleGraphConditionalOutputState>> = {}
  if (!executionDetail) {
    return outputStatesByNode
  }

  for (const artifact of executionDetail.artifacts) {
    const metadata = parseRecord(artifact.metadata)
    if (metadata?.operationKey !== 'system.logic_if_branch') {
      continue
    }

    const activePort = artifact.port_key === 'true_value' || artifact.port_key === 'false_value'
      ? artifact.port_key
      : readBranchPortFromMetadata(metadata)
    if (!activePort) {
      continue
    }

    const inactivePort = activePort === 'true_value' ? 'false_value' : 'true_value'
    writeConditionalOutputState(outputStatesByNode, artifact.node_id, activePort, 'active')
    writeConditionalOutputState(outputStatesByNode, artifact.node_id, inactivePort, 'inactive')
  }

  for (const log of executionDetail.logs ?? []) {
    if (log.event_type !== 'node_skipped_inactive_branch') {
      continue
    }

    const details = parseRecord(log.details)
    const disabledInputs = Array.isArray(details?.disabledInputs) ? details.disabledInputs : []
    for (const disabledInput of disabledInputs) {
      if (!disabledInput || typeof disabledInput !== 'object') {
        continue
      }

      const inputRecord = disabledInput as Record<string, unknown>
      const sourceNodeId = typeof inputRecord.sourceNodeId === 'string' ? inputRecord.sourceNodeId : null
      const sourcePortKey = typeof inputRecord.sourcePortKey === 'string' ? inputRecord.sourcePortKey : null
      writeConditionalOutputState(outputStatesByNode, sourceNodeId, sourcePortKey, 'inactive')
    }
  }

  return outputStatesByNode
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
    const conditionalInputNodeIds = new Set<string>()
    const nodeById = new Map(nodes.map((node) => [node.id, node]))

    for (const edge of edges) {
      const sourceHandle = parseHandleId(edge.sourceHandle)
      const targetHandle = parseHandleId(edge.targetHandle)
      const sourceNode = nodeById.get(edge.source)
      if (sourceNode && getModuleOperationKey(sourceNode.data.module) === 'system.logic_if_branch') {
        conditionalInputNodeIds.add(edge.target)
      }

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
    const nodeStructureSignature = nodes
      .map((node) => `${node.id}:${node.data.module.id}:${node.data.disabled === true ? 'disabled' : 'enabled'}`)
      .join('|')
    const edgeSignature = edges
      .map((edge) => `${edge.id}:${edge.source}:${edge.sourceHandle ?? ''}:${edge.target}:${edge.targetHandle ?? ''}`)
      .join('|')

    if (!executionDetail) {
      const syncSignature = `no-execution|${nodeStructureSignature}|${edgeSignature}|${fallbackPreviewSignature}`
      if (lastNodePreviewSyncSignatureRef.current === syncSignature) {
        return
      }

      lastNodePreviewSyncSignatureRef.current = syncSignature
      setNodes((currentNodes) => {
        const plannedOrderedNodeIds = buildPlannedNodeExecutionOrder(currentNodes, edges)
        const plannedOrderIndex = buildNodeOrderIndex(plannedOrderedNodeIds)

        return currentNodes.map((node) => {
          const fallbackPreview = latestArtifactPreviewByNode.get(node.id)

          return {
            ...node,
            data: {
              ...node.data,
              plannedExecutionOrder: (plannedOrderIndex.get(node.id) ?? -1) + 1 || null,
              activationHint: conditionalInputNodeIds.has(node.id) ? 'conditional-input' : null,
              executionStatus: fallbackPreview ? 'completed' : 'idle',
              executionSkipReason: null,
              conditionalOutputStates: null,
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
        })
      })
      return
    }

    const executionPlan = executionDetail.execution.execution_plan
      ? JSON.parse(executionDetail.execution.execution_plan) as { orderedNodeIds?: string[]; reusedNodeIds?: string[] }
      : { orderedNodeIds: [] }

    const orderedNodeIds = executionPlan.orderedNodeIds ?? []
    const nodeOrderIndex = buildNodeOrderIndex(orderedNodeIds)
    const orderedNodeIdSet = new Set(orderedNodeIds)
    const reusedNodeIds = new Set(executionPlan.reusedNodeIds ?? [])
    const skippedNodeReasons = buildSkippedNodeReasonMap(executionDetail)
    const conditionalOutputStatesByNode = buildConditionalOutputStates(executionDetail)
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
    const conditionalOutputStateSignature = Object.entries(conditionalOutputStatesByNode)
      .sort(([leftNodeId], [rightNodeId]) => leftNodeId.localeCompare(rightNodeId))
      .map(([nodeId, stateByPort]) => `${nodeId}:${Object.entries(stateByPort).sort(([leftPort], [rightPort]) => leftPort.localeCompare(rightPort)).map(([portKey, state]) => `${portKey}:${state}`).join(',')}`)
      .join('|')
    const skippedNodeReasonSignature = Array.from(skippedNodeReasons.entries())
      .sort(([leftNodeId], [rightNodeId]) => leftNodeId.localeCompare(rightNodeId))
      .map(([nodeId, reason]) => `${nodeId}:${reason}`)
      .join('|')
    const syncSignature = `${executionPlanSignature}|${executionArtifactSignature}|${conditionalOutputStateSignature}|${skippedNodeReasonSignature}|${nodeStructureSignature}|${edgeSignature}|${fallbackPreviewSignature}`
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
          nodeOrderIndex,
          artifactNodeIds,
          skippedNodeReasons,
          executionStatus: executionDetail.execution.status,
          failedNodeId: executionDetail.execution.failed_node_id,
        })
        const executionStatus = nodeArtifacts.length > 0 || orderedNodeIdSet.has(node.id)
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
            plannedExecutionOrder: (nodeOrderIndex.get(node.id) ?? -1) + 1 || null,
            activationHint: conditionalInputNodeIds.has(node.id) ? 'conditional-input' : null,
            executionStatus,
            executionSkipReason: skippedNodeReasons.get(node.id) ?? null,
            conditionalOutputStates: conditionalOutputStatesByNode[node.id] ?? null,
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
  }, [edges, executionDetail, latestArtifactPreviewByNode, nodes, setNodes])
}
