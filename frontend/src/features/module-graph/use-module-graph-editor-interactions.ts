import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { addEdge, MarkerType, type Connection } from '@xyflow/react'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import type { GraphWorkflowExposedInput, ModuleDefinitionRecord } from '@/lib/api'
import {
  buildAutoLayoutedNodes,
  buildGraphEditorSnapshot,
  buildModuleEdgePresentation,
  findNodePort,
  getModulePortCompatibility,
  parseHandleId,
  type ModuleGraphEdge,
  type ModuleGraphNode,
} from './module-graph-shared'

/** Own local canvas/editor interactions for the module-graph page. */
export function useModuleGraphEditorInteractions({
  nodes,
  edges,
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

    setEdges((currentEdges) =>
      addEdge(
        {
          ...connection,
          markerEnd: { type: MarkerType.ArrowClosed },
          ...buildModuleEdgePresentation(sourcePort, targetPort),
        },
        currentEdges,
      ),
    )

    if (compatibility === 'string-bridge') {
      showSnackbar({ message: 'text ↔ prompt 연결은 허용돼. 이런 브리지 연결은 점선으로 표시해둘게.', tone: 'info' })
    }
  }, [isValidConnection, nodes, setEdges, showSnackbar])

  /** Add one new module node to the graph canvas. */
  const handleAddModuleNode = useCallback((module: ModuleDefinitionRecord) => {
    const nodeId = `module-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const offset = nodes.length % 5

    setNodes((current) => [
      ...current,
      {
        id: nodeId,
        type: 'module',
        position: {
          x: 80 + offset * 40,
          y: 80 + current.length * 48,
        },
        data: {
          module,
          inputValues: {},
        },
      },
    ])
    setSelectedEdgeId(null)
    setSelectedNodeId(nodeId)
  }, [nodes.length, setNodes, setSelectedEdgeId, setSelectedNodeId])

  /** Add one library module and close the library modal immediately after. */
  const handleAddModuleFromLibrary = useCallback((module: ModuleDefinitionRecord) => {
    handleAddModuleNode(module)
    setIsModuleLibraryOpen(false)
  }, [handleAddModuleNode, setIsModuleLibraryOpen])

  /** Duplicate the currently selected node with copied input values. */
  const handleDuplicateSelectedNode = useCallback(() => {
    if (!selectedNode) {
      return
    }

    const duplicatedNodeId = `module-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const duplicatedInputValues = JSON.parse(JSON.stringify(selectedNode.data.inputValues || {})) as Record<string, unknown>

    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id: duplicatedNodeId,
        type: 'module',
        position: {
          x: selectedNode.position.x + 48,
          y: selectedNode.position.y + 48,
        },
        data: {
          module: selectedNode.data.module,
          inputValues: duplicatedInputValues,
        },
      },
    ])
    setSelectedEdgeId(null)
    setSelectedNodeId(duplicatedNodeId)
    showSnackbar({ message: '선택 노드를 복제했어.', tone: 'info' })
  }, [selectedNode, setNodes, setSelectedEdgeId, setSelectedNodeId, showSnackbar])

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

  /** Toggle whether one candidate input is exposed at the workflow level. */
  const handleToggleWorkflowExposedInput = useCallback((inputDefinition: GraphWorkflowExposedInput) => {
    setWorkflowExposedInputs((current) => {
      const alreadySelected = current.some((item) => item.id === inputDefinition.id)
      if (alreadySelected) {
        return current.filter((item) => item.id !== inputDefinition.id)
      }

      return [...current, inputDefinition]
    })
  }, [setWorkflowExposedInputs])

  /** Patch one exposed-input definition in local workflow metadata. */
  const handleUpdateWorkflowExposedInput = useCallback((inputId: string, patch: Partial<GraphWorkflowExposedInput>) => {
    setWorkflowExposedInputs((current) =>
      current.map((inputDefinition) =>
        inputDefinition.id === inputId
          ? {
              ...inputDefinition,
              ...patch,
            }
          : inputDefinition,
      ),
    )
  }, [setWorkflowExposedInputs])

  /** Reorder one exposed input within the workflow metadata list. */
  const handleMoveWorkflowExposedInput = useCallback((inputId: string, direction: 'up' | 'down') => {
    setWorkflowExposedInputs((current) => {
      const index = current.findIndex((inputDefinition) => inputDefinition.id === inputId)
      if (index === -1) {
        return current
      }

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current
      }

      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
  }, [setWorkflowExposedInputs])

  /** Store one selected image as the default value for one exposed workflow input. */
  const handleWorkflowExposedInputDefaultImageChange = useCallback(async (inputId: string, image?: SelectedImageDraft) => {
    if (!image) {
      handleUpdateWorkflowExposedInput(inputId, { default_value: undefined })
      return
    }

    handleUpdateWorkflowExposedInput(inputId, { default_value: image.dataUrl })
  }, [handleUpdateWorkflowExposedInput])

  /** Auto-layout the current graph and refit the viewport afterwards. */
  const handleAutoLayout = useCallback(() => {
    if (nodes.length === 0) {
      return
    }

    setNodes((currentNodes) => buildAutoLayoutedNodes(currentNodes, edges))
    fitViewAfterAutoLayout()
    showSnackbar({ message: '그래프를 자동 정렬했어.', tone: 'info' })
  }, [edges, fitViewAfterAutoLayout, nodes.length, setNodes, showSnackbar])

  /** Remove the currently selected node together with its attached edges and exposed inputs. */
  const handleRemoveSelectedNode = useCallback(() => {
    if (!selectedNodeId) {
      return
    }

    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId))
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId))
    setWorkflowExposedInputs((current) => current.filter((inputDefinition) => inputDefinition.node_id !== selectedNodeId))
    setSelectedNodeId(null)
  }, [selectedNodeId, setEdges, setNodes, setSelectedNodeId, setWorkflowExposedInputs])

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
    handleDuplicateSelectedNode,
    handleNodeValueChange,
    handleNodeValueClear,
    handleNodeImageChange,
    handleWorkflowRunInputChange,
    handleWorkflowRunInputClear,
    handleWorkflowRunInputImageChange,
    handleToggleWorkflowExposedInput,
    handleUpdateWorkflowExposedInput,
    handleMoveWorkflowExposedInput,
    handleWorkflowExposedInputDefaultImageChange,
    handleAutoLayout,
    handleRemoveSelectedNode,
    handleRemoveSelectedEdge,
    handleResetCanvas,
    resetEmptyWorkflowDraft,
  }
}
