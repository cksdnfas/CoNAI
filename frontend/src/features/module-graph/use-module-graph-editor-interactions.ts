import { useCallback, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { addEdge, MarkerType, type Connection } from '@xyflow/react'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import type { GraphWorkflowExposedInput, ModuleDefinitionRecord } from '@/lib/api'
import { copyTextToClipboard } from '@/lib/clipboard'
import {
  buildAutoLayoutedNodes,
  buildGraphEditorSnapshot,
  buildModuleEdgePresentation,
  buildModuleGraphClipboardPayload,
  cloneModuleGraphValue,
  createModuleGraphEdgeId,
  createModuleGraphNodeId,
  findNodePort,
  getModuleBaseDisplayName,
  getModulePortCompatibility,
  parseHandleId,
  parseModuleGraphClipboardPayload,
  serializeModuleGraphClipboardPayload,
  type ModuleGraphEdge,
  type ModuleGraphNode,
} from './module-graph-shared'

/** Own local canvas/editor interactions for the module-graph page. */
export function useModuleGraphEditorInteractions({
  nodes,
  edges,
  modules,
  selectedNode,
  selectedNodeId,
  selectedEdgeId,
  selectedFolderId,
  setNodes,
  setEdges,
  setSelectedGraphId,
  setDraftWorkflowFolderId,
  setSelectedExecutionId,
  setSelectedNodeId,
  setSelectedEdgeId,
  setWorkflowName,
  setWorkflowDescription,
  setWorkflowExposedInputs,
  setWorkflowRunInputValues,
  setLastSavedSnapshot,
  setIsModuleLibraryOpen,
  confirmDiscardUnsavedChanges,
  fitViewAfterAutoLayout,
  showSnackbar,
}: {
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  modules: ModuleDefinitionRecord[]
  selectedNode: ModuleGraphNode | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
  selectedFolderId: number | null
  setNodes: Dispatch<SetStateAction<ModuleGraphNode[]>>
  setEdges: Dispatch<SetStateAction<ModuleGraphEdge[]>>
  setSelectedGraphId: Dispatch<SetStateAction<number | null>>
  setDraftWorkflowFolderId: Dispatch<SetStateAction<number | null>>
  setSelectedExecutionId: Dispatch<SetStateAction<number | null>>
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>
  setWorkflowName: Dispatch<SetStateAction<string>>
  setWorkflowDescription: Dispatch<SetStateAction<string>>
  setWorkflowExposedInputs: Dispatch<SetStateAction<GraphWorkflowExposedInput[]>>
  setWorkflowRunInputValues: Dispatch<SetStateAction<Record<string, unknown>>>
  setLastSavedSnapshot: Dispatch<SetStateAction<string>>
  setIsModuleLibraryOpen: Dispatch<SetStateAction<boolean>>
  confirmDiscardUnsavedChanges: () => boolean
  fitViewAfterAutoLayout: () => void
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const lastCopiedSelectionRef = useRef<string | null>(null)

  /** Validate whether one graph-port connection is allowed. */
  const isValidConnection = useCallback(
    (edgeOrConnection: Connection | ModuleGraphEdge) => {
      const connection = edgeOrConnection as Connection

      if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
        return false
      }

      if (connection.source === connection.target) {
        return false
      }

      const sourceHandle = parseHandleId(connection.sourceHandle)
      const targetHandle = parseHandleId(connection.targetHandle)
      if (!sourceHandle?.portKey || !targetHandle?.portKey) {
        return false
      }

      const sourceNode = nodes.find((node) => node.id === connection.source)
      const targetNode = nodes.find((node) => node.id === connection.target)
      if (!sourceNode || !targetNode) {
        return false
      }

      const sourcePort = sourceNode.data.module.output_ports.find((port) => port.key === sourceHandle.portKey)
      const targetPort = targetNode.data.module.exposed_inputs.find((port) => port.key === targetHandle.portKey)
      if (!sourcePort || !targetPort) {
        return false
      }

      return getModulePortCompatibility(sourcePort.data_type, targetPort.data_type) !== 'incompatible'
    },
    [nodes],
  )

  /** Create one edge connection and apply presentation metadata when valid. */
  const handleConnect = useCallback((connection: Connection) => {
    if (!isValidConnection(connection)) {
      showSnackbar({ message: '포트 타입이 맞지 않아서 연결할 수 없어.', tone: 'error' })
      return
    }

    const sourceNode = nodes.find((node) => node.id === connection.source)
    const targetNode = nodes.find((node) => node.id === connection.target)
    const sourceHandle = parseHandleId(connection.sourceHandle)
    const targetHandle = parseHandleId(connection.targetHandle)
    const sourcePort = findNodePort(sourceNode, 'out', sourceHandle?.portKey)
    const targetPort = findNodePort(targetNode, 'in', targetHandle?.portKey)
    const compatibility = getModulePortCompatibility(sourcePort?.data_type, targetPort?.data_type)

    setEdges((currentEdges) => {
      const nextConnection = {
        ...connection,
        markerEnd: { type: MarkerType.ArrowClosed },
        ...buildModuleEdgePresentation(sourcePort, targetPort),
      }

      const trimmedEdges = targetPort?.multiple
        ? currentEdges
        : currentEdges.filter((edge) => !(edge.target === connection.target && edge.targetHandle === connection.targetHandle))

      return addEdge(nextConnection, trimmedEdges)
    })

    if (compatibility === 'string-bridge') {
      showSnackbar({ message: 'text ↔ prompt 연결은 허용돼. 이런 브리지 연결은 점선으로 표시해둘게.', tone: 'info' })
    }
  }, [isValidConnection, nodes, setEdges, showSnackbar])

  /** Add one new module node to the graph canvas, optionally pre-connecting it from one dragged port. */
  const handleAddModuleNode = useCallback((
    module: ModuleDefinitionRecord,
    options?: {
      position?: { x: number; y: number }
      connectionStart?: { nodeId: string; handleId: string; handleType: 'source' | 'target' }
    },
  ) => {
    const nodeId = createModuleGraphNodeId()
    const offset = nodes.length % 5
    const nextPosition = options?.position ?? {
      x: 80 + offset * 40,
      y: 80 + nodes.length * 48,
    }

    setNodes((current) => [
      ...current,
      {
        id: nodeId,
        type: 'module',
        position: nextPosition,
        data: {
          module,
          label: undefined,
          inputValues: {},
        },
      },
    ])

    const connectionStart = options?.connectionStart
    if (connectionStart) {
      const existingNode = nodes.find((node) => node.id === connectionStart.nodeId)
      const parsedHandle = parseHandleId(connectionStart.handleId)

      if (existingNode && parsedHandle) {
        if (connectionStart.handleType === 'source') {
          const sourcePort = existingNode.data.module.output_ports.find((port) => port.key === parsedHandle.portKey)
          const compatibleTargetPort = sourcePort
            ? module.exposed_inputs.find((port) => getModulePortCompatibility(sourcePort.data_type, port.data_type) !== 'incompatible')
            : null

          if (sourcePort && compatibleTargetPort) {
            const nextConnection: Connection = {
              source: existingNode.id,
              sourceHandle: connectionStart.handleId,
              target: nodeId,
              targetHandle: `in:${compatibleTargetPort.key}`,
            }

            if (isValidConnection(nextConnection)) {
              setEdges((currentEdges) => addEdge(
                {
                  id: createModuleGraphEdgeId(),
                  ...nextConnection,
                  markerEnd: { type: MarkerType.ArrowClosed },
                  ...buildModuleEdgePresentation(sourcePort, compatibleTargetPort),
                },
                currentEdges,
              ))
            }
          }
        } else {
          const targetPort = existingNode.data.module.exposed_inputs.find((port) => port.key === parsedHandle.portKey)
          const compatibleSourcePort = targetPort
            ? module.output_ports.find((port) => getModulePortCompatibility(port.data_type, targetPort.data_type) !== 'incompatible')
            : null

          if (targetPort && compatibleSourcePort) {
            const nextConnection: Connection = {
              source: nodeId,
              sourceHandle: `out:${compatibleSourcePort.key}`,
              target: existingNode.id,
              targetHandle: connectionStart.handleId,
            }

            if (isValidConnection(nextConnection)) {
              setEdges((currentEdges) => addEdge(
                {
                  id: createModuleGraphEdgeId(),
                  ...nextConnection,
                  markerEnd: { type: MarkerType.ArrowClosed },
                  ...buildModuleEdgePresentation(compatibleSourcePort, targetPort),
                },
                targetPort.multiple
                  ? currentEdges
                  : currentEdges.filter((edge) => !(edge.target === existingNode.id && edge.targetHandle === connectionStart.handleId)),
              ))
            }
          }
        }
      }
    }

    setSelectedEdgeId(null)
    setSelectedNodeId(nodeId)
  }, [isValidConnection, nodes, setEdges, setNodes, setSelectedEdgeId, setSelectedNodeId])

  /** Add one library module and close the library modal immediately after. */
  const handleAddModuleFromLibrary = useCallback((module: ModuleDefinitionRecord) => {
    handleAddModuleNode(module)
    setIsModuleLibraryOpen(false)
  }, [handleAddModuleNode, setIsModuleLibraryOpen])

  /** Duplicate one node by id with copied input values. */
  const handleDuplicateNodeById = useCallback((nodeId: string) => {
    const nodeToDuplicate = nodes.find((node) => node.id === nodeId)
    if (!nodeToDuplicate) {
      return
    }

    const duplicatedNodeId = createModuleGraphNodeId()
    const duplicatedInputValues = cloneModuleGraphValue(nodeToDuplicate.data.inputValues || {}) as Record<string, unknown>

    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id: duplicatedNodeId,
        type: 'module',
        position: {
          x: nodeToDuplicate.position.x + 48,
          y: nodeToDuplicate.position.y + 48,
        },
        data: {
          module: nodeToDuplicate.data.module,
          label: nodeToDuplicate.data.label,
          inputValues: duplicatedInputValues,
        },
      },
    ])
    setSelectedEdgeId(null)
    setSelectedNodeId(duplicatedNodeId)
    showSnackbar({ message: '노드를 복제했어.', tone: 'info' })
  }, [nodes, setNodes, setSelectedEdgeId, setSelectedNodeId, showSnackbar])

  /** Duplicate the currently selected node with copied input values. */
  const handleDuplicateSelectedNode = useCallback(() => {
    if (!selectedNode) {
      return
    }

    handleDuplicateNodeById(selectedNode.id)
  }, [handleDuplicateNodeById, selectedNode])

  /** Copy the current node selection into a graph-aware clipboard payload. */
  const handleCopySelectedNodesToClipboard = useCallback(async () => {
    const selectedNodes = nodes.filter((node) => node.selected)
    if (selectedNodes.length === 0) {
      return false
    }

    const serializedPayload = serializeModuleGraphClipboardPayload(buildModuleGraphClipboardPayload(selectedNodes, edges))

    try {
      await copyTextToClipboard(serializedPayload)
      lastCopiedSelectionRef.current = serializedPayload
      showSnackbar({ message: selectedNodes.length === 1 ? '노드를 복사했어.' : `${selectedNodes.length}개 노드를 복사했어.`, tone: 'info' })
      return true
    } catch {
      showSnackbar({ message: '클립보드에 노드를 복사하지 못했어.', tone: 'error' })
      return false
    }
  }, [edges, nodes, showSnackbar])

  /** Paste one copied node selection while preserving relative layout and internal edges. */
  const handlePasteNodesFromClipboard = useCallback(async (options?: { position?: { x: number; y: number } }) => {
    let clipboardReadFailed = false
    let clipboardText: string | null = null

    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        clipboardText = await navigator.clipboard.readText()
      } catch {
        clipboardReadFailed = true
      }
    } else {
      clipboardReadFailed = true
    }

    let payload = clipboardText ? parseModuleGraphClipboardPayload(clipboardText) : null
    if (!payload && clipboardReadFailed) {
      payload = parseModuleGraphClipboardPayload(lastCopiedSelectionRef.current ?? '')
    }

    if (!payload || payload.nodes.length === 0) {
      return false
    }

    const moduleById = new Map(modules.map((module) => [module.id, module]))
    const sourceAnchor = payload.nodes.reduce(
      (current, node) => ({
        x: Math.min(current.x, node.position.x),
        y: Math.min(current.y, node.position.y),
      }),
      { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
    )
    const pasteAnchor = options?.position ?? {
      x: sourceAnchor.x + 48,
      y: sourceAnchor.y + 48,
    }

    const nextNodes: ModuleGraphNode[] = []
    const nodeIdMap = new Map<string, string>()

    for (const copiedNode of payload.nodes) {
      const module = moduleById.get(copiedNode.moduleId)
      if (!module) {
        continue
      }

      const nextNodeId = createModuleGraphNodeId()
      nodeIdMap.set(copiedNode.id, nextNodeId)
      nextNodes.push({
        id: nextNodeId,
        type: 'module',
        position: {
          x: pasteAnchor.x + (copiedNode.position.x - sourceAnchor.x),
          y: pasteAnchor.y + (copiedNode.position.y - sourceAnchor.y),
        },
        selected: true,
        data: {
          module,
          label: copiedNode.label,
          inputValues: cloneModuleGraphValue(copiedNode.inputValues),
        },
      })
    }

    if (nextNodes.length === 0) {
      showSnackbar({ message: '붙여넣을 수 있는 노드를 찾지 못했어.', tone: 'error' })
      return false
    }

    const nextNodeMap = new Map(nextNodes.map((node) => [node.id, node]))
    const nextEdges = payload.edges.flatMap((copiedEdge) => {
      const sourceNodeId = nodeIdMap.get(copiedEdge.source)
      const targetNodeId = nodeIdMap.get(copiedEdge.target)
      if (!sourceNodeId || !targetNodeId) {
        return []
      }

      const sourceNode = nextNodeMap.get(sourceNodeId)
      const targetNode = nextNodeMap.get(targetNodeId)
      const sourceHandle = parseHandleId(copiedEdge.sourceHandle)
      const targetHandle = parseHandleId(copiedEdge.targetHandle)
      const sourcePort = findNodePort(sourceNode, 'out', sourceHandle?.portKey)
      const targetPort = findNodePort(targetNode, 'in', targetHandle?.portKey)

      return [{
        id: createModuleGraphEdgeId(),
        source: sourceNodeId,
        target: targetNodeId,
        sourceHandle: copiedEdge.sourceHandle,
        targetHandle: copiedEdge.targetHandle,
        markerEnd: { type: MarkerType.ArrowClosed },
        ...buildModuleEdgePresentation(sourcePort, targetPort),
      }]
    })

    setNodes((currentNodes) => [
      ...currentNodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
      ...nextNodes,
    ])
    setEdges((currentEdges) => [
      ...currentEdges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
      ...nextEdges,
    ])
    setSelectedEdgeId(null)
    setSelectedNodeId(nextNodes.length === 1 ? nextNodes[0].id : null)
    showSnackbar({ message: nextNodes.length === 1 ? '노드를 붙여넣었어.' : `${nextNodes.length}개 노드를 붙여넣었어.`, tone: 'info' })
    return true
  }, [modules, setEdges, setNodes, setSelectedEdgeId, setSelectedNodeId, showSnackbar])

  /** Update one node label in local editor state. */
  const handleNodeLabelChange = useCallback((nodeId: string, label: string) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId) {
          return node
        }

        const trimmedLabel = label.trim()
        return {
          ...node,
          data: {
            ...node.data,
            label: trimmedLabel.length > 0 && trimmedLabel !== getModuleBaseDisplayName(node.data.module) ? trimmedLabel : undefined,
          },
        }
      }),
    )
  }, [setNodes])

  /** Update one node input value in local editor state. */
  const handleNodeValueChange = useCallback((nodeId: string, portKey: string, value: unknown) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                inputValues: {
                  ...node.data.inputValues,
                  [portKey]: value,
                },
              },
            }
          : node,
      ),
    )
  }, [setNodes])

  /** Remove one node input value from local editor state. */
  const handleNodeValueClear = useCallback((nodeId: string, portKey: string) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId) {
          return node
        }

        const nextValues = { ...node.data.inputValues }
        delete nextValues[portKey]

        return {
          ...node,
          data: {
            ...node.data,
            inputValues: nextValues,
          },
        }
      }),
    )
  }, [setNodes])

  /** Store one selected image as a node input data URL. */
  const handleNodeImageChange = useCallback(async (nodeId: string, portKey: string, image?: SelectedImageDraft) => {
    if (!image) {
      handleNodeValueClear(nodeId, portKey)
      return
    }

    handleNodeValueChange(nodeId, portKey, image.dataUrl)
  }, [handleNodeValueChange, handleNodeValueClear])

  /** Update one workflow-run exposed input value. */
  const handleWorkflowRunInputChange = useCallback((inputId: string, value: unknown) => {
    setWorkflowRunInputValues((current) => ({
      ...current,
      [inputId]: value,
    }))
  }, [setWorkflowRunInputValues])

  /** Clear one workflow-run exposed input value. */
  const handleWorkflowRunInputClear = useCallback((inputId: string) => {
    setWorkflowRunInputValues((current) => {
      const nextValues = { ...current }
      delete nextValues[inputId]
      return nextValues
    })
  }, [setWorkflowRunInputValues])

  /** Store one selected image as a workflow-run input data URL. */
  const handleWorkflowRunInputImageChange = useCallback(async (inputId: string, image?: SelectedImageDraft) => {
    if (!image) {
      handleWorkflowRunInputClear(inputId)
      return
    }

    handleWorkflowRunInputChange(inputId, image.dataUrl)
  }, [handleWorkflowRunInputChange, handleWorkflowRunInputClear])

  /** Auto-layout the current graph and refit the viewport afterwards. */
  const handleAutoLayout = useCallback(() => {
    if (nodes.length === 0) {
      return
    }

    setNodes((currentNodes) => buildAutoLayoutedNodes(currentNodes, edges))
    fitViewAfterAutoLayout()
    showSnackbar({ message: '그래프를 자동 정렬했어.', tone: 'info' })
  }, [edges, fitViewAfterAutoLayout, nodes.length, setNodes, showSnackbar])

  /** Disconnect all incoming edges from one concrete node input port. */
  const handleDisconnectNodeInput = useCallback((nodeId: string, portKey: string) => {
    const targetHandle = `in:${portKey}`
    let removedCount = 0

    setEdges((currentEdges) => {
      const nextEdges = currentEdges.filter((edge) => {
        const shouldKeep = !(edge.target === nodeId && edge.targetHandle === targetHandle)
        if (!shouldKeep) {
          removedCount += 1
        }
        return shouldKeep
      })
      return nextEdges
    })

    if (removedCount > 0) {
      showSnackbar({ message: '입력 연결을 끊었어.', tone: 'info' })
    }
  }, [setEdges, showSnackbar])

  /** Disconnect every edge attached to one node. */
  const handleDisconnectAllNodeConnections = useCallback((nodeId: string) => {
    let removedCount = 0

    setEdges((currentEdges) => {
      const nextEdges = currentEdges.filter((edge) => {
        const shouldKeep = edge.source !== nodeId && edge.target !== nodeId
        if (!shouldKeep) {
          removedCount += 1
        }
        return shouldKeep
      })
      return nextEdges
    })

    if (removedCount > 0) {
      showSnackbar({ message: '노드의 모든 연결을 끊었어.', tone: 'info' })
    }
  }, [setEdges, showSnackbar])

  /** Remove one node together with its attached edges and exposed-input metadata. */
  const handleRemoveNodeById = useCallback((nodeId: string) => {
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== nodeId))
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    setWorkflowExposedInputs((current) => current.filter((inputDefinition) => inputDefinition.node_id !== nodeId))
    setSelectedNodeId((current) => (current === nodeId ? null : current))
  }, [setEdges, setNodes, setSelectedNodeId, setWorkflowExposedInputs])

  /** Remove the currently selected node together with its attached edges and exposed inputs. */
  const handleRemoveSelectedNode = useCallback(() => {
    if (!selectedNodeId) {
      return
    }

    handleRemoveNodeById(selectedNodeId)
  }, [handleRemoveNodeById, selectedNodeId])

  /** Remove the currently selected edge. */
  const handleRemoveSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) {
      return
    }

    setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdgeId))
    setSelectedEdgeId(null)
  }, [selectedEdgeId, setEdges, setSelectedEdgeId])

  /** Reset the editor draft back to an empty workflow rooted in the selected folder. */
  const resetEmptyWorkflowDraft = useCallback(() => {
    setNodes([])
    setEdges([])
    setSelectedGraphId(null)
    setDraftWorkflowFolderId(selectedFolderId)
    setSelectedExecutionId(null)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setWorkflowName('Workflow Draft')
    setWorkflowDescription('')
    setWorkflowExposedInputs([])
    setWorkflowRunInputValues({})
    setLastSavedSnapshot(
      buildGraphEditorSnapshot({
        name: 'Workflow Draft',
        description: '',
        nodes: [],
        edges: [],
        workflowMetadata: {
          exposed_inputs: [],
        },
      }),
    )
  }, [selectedFolderId, setDraftWorkflowFolderId, setEdges, setLastSavedSnapshot, setNodes, setSelectedEdgeId, setSelectedExecutionId, setSelectedGraphId, setSelectedNodeId, setWorkflowDescription, setWorkflowExposedInputs, setWorkflowName, setWorkflowRunInputValues])

  /** Reset the full editor canvas after confirmation when needed. */
  const handleResetCanvas = useCallback(() => {
    if (!confirmDiscardUnsavedChanges()) {
      return
    }

    resetEmptyWorkflowDraft()
  }, [confirmDiscardUnsavedChanges, resetEmptyWorkflowDraft])

  return {
    isValidConnection,
    handleConnect,
    handleAddModuleNode,
    handleAddModuleFromLibrary,
    handleDuplicateNodeById,
    handleDuplicateSelectedNode,
    handleCopySelectedNodesToClipboard,
    handlePasteNodesFromClipboard,
    handleNodeLabelChange,
    handleNodeValueChange,
    handleNodeValueClear,
    handleNodeImageChange,
    handleWorkflowRunInputChange,
    handleWorkflowRunInputClear,
    handleWorkflowRunInputImageChange,
    handleAutoLayout,
    handleDisconnectNodeInput,
    handleDisconnectAllNodeConnections,
    handleRemoveNodeById,
    handleRemoveSelectedNode,
    handleRemoveSelectedEdge,
    handleResetCanvas,
    resetEmptyWorkflowDraft,
  }
}
