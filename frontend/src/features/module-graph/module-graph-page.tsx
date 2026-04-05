import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Folder, FolderOpen, FolderPlus, PenSquare, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import {
  type GraphWorkflowFolderDeleteMode,
  getAppSettings,
  getGraphExecution,
  getGraphWorkflowExecutions,
  getGraphWorkflowFolders,
  getGraphWorkflows,
  getModuleDefinitions,
  type GraphExecutionArtifactRecord,
  type GraphExecutionRecord,
  type GraphWorkflowExposedInput,
  type GraphWorkflowFolderRecord,
  type GraphWorkflowRecord,
  type ModuleDefinitionRecord,
} from '@/lib/api'
import { GraphExecutionPanel } from './components/graph-execution-panel'
import { ModuleGraphNodeCard } from './components/module-graph-node-card'
import { ModuleLibraryPanel } from './components/module-library-panel'
import { ModuleWorkflowBrowseView } from './components/module-workflow-browse-view'
import { type EditorSupportSectionKey } from './components/module-workflow-editor-support-panel'
import { ModuleWorkflowEditorView } from './components/module-workflow-editor-view'
import { ModuleGraphEditorSupportSubtitle, ModuleGraphWorkflowBrowseSidePanel, ModuleGraphWorkflowEditorSupportPanels, ModuleGraphWorkflowSetupFolderPanel } from './components/module-graph-page-sections'
import { SavedGraphList } from './components/saved-graph-list'
import { WorkflowFolderSettingsPanel } from './components/workflow-folder-settings-panel'
import { type WorkflowValidationIssue } from './components/workflow-validation-panel'
import {
  buildAutoLayoutedNodes,
  buildGraphEditorSnapshot,
  buildModuleEdgePresentation,
  buildNodeArtifactPreview,
  findNodePort,
  getModulePortCompatibility,
  getNodeExecutionStatus,
  parseHandleId,
  type ModuleGraphEdge,
  type ModuleGraphNode,
} from './module-graph-shared'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { buildWorkflowExposedInputId } from './module-graph-validation'
import { useModuleGraphPageViewModel } from './use-module-graph-page-view-model'
import { useModuleGraphExecutionActions } from './use-module-graph-execution-actions'
import { useModuleGraphBrowseActions } from './use-module-graph-browse-actions'

type ModuleWorkflowWorkspaceProps = {
  embedded?: boolean
}

const UNSAVED_CHANGES_CONFIRM_MESSAGE = '저장하지 않은 변경사항이 있어. 이 작업을 진행하면 현재 편집 내용이 사라질 수 있어. 계속할까?'

function ModuleWorkflowWorkspaceInner({ embedded = false }: ModuleWorkflowWorkspaceProps) {
  const { showSnackbar } = useSnackbar()
  const reactFlow = useReactFlow()
  const [workflowName, setWorkflowName] = useState('Workflow Draft')
  const [workflowDescription, setWorkflowDescription] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [draftWorkflowFolderId, setDraftWorkflowFolderId] = useState<number | null>(null)
  const [draftChildFolderName, setDraftChildFolderName] = useState('')
  const [draftChildFolderDescription, setDraftChildFolderDescription] = useState('')
  const [selectedGraphId, setSelectedGraphId] = useState<number | null>(null)
  const [selectedExecutionId, setSelectedExecutionId] = useState<number | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [selectedValidationPortKey, setSelectedValidationPortKey] = useState<string | null>(null)
  const isDesktopPageLayout = useDesktopPageLayout()
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() =>
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
  const [workflowView, setWorkflowView] = useState<'browse' | 'edit'>('browse')
  const [isModuleLibraryOpen, setIsModuleLibraryOpen] = useState(false)
  const [isBrowseManageModalOpen, setIsBrowseManageModalOpen] = useState(false)
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<GraphWorkflowFolderRecord | null>(null)
  const [isEditorSupportOpen, setIsEditorSupportOpen] = useState(false)
  const [activeEditorSupportSection, setActiveEditorSupportSection] = useState<EditorSupportSectionKey>('setup')
  const [workflowExposedInputs, setWorkflowExposedInputs] = useState<GraphWorkflowExposedInput[]>([])
  const [workflowRunInputValues, setWorkflowRunInputValues] = useState<Record<string, unknown>>({})
  const previousExecutionStatusesRef = useRef<Record<number, GraphExecutionRecord['status']>>({})
  const lastNodePreviewSyncSignatureRef = useRef('')
  const editorSupportSectionRefs = useRef<Record<EditorSupportSectionKey, HTMLDivElement | null>>({
    setup: null,
    inspector: null,
    inputs: null,
    validation: null,
    results: null,
  })
  const [nodes, setNodes, onNodesChange] = useNodesState<ModuleGraphNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<ModuleGraphEdge>([])

  const modulesQuery = useQuery({
    queryKey: ['module-graph-modules'],
    queryFn: () => getModuleDefinitions(true),
  })

  const settingsQuery = useQuery({
    queryKey: ['app-settings', 'module-graph-validation'],
    queryFn: getAppSettings,
  })

  const reactFlowColorMode: 'light' | 'dark' | 'system' =
    settingsQuery.data?.appearance.themeMode ?? DEFAULT_APPEARANCE_SETTINGS.themeMode

  const graphWorkflowsQuery = useQuery({
    queryKey: ['module-graph-workflows'],
    queryFn: () => getGraphWorkflows(true),
  })

  const graphWorkflowFoldersQuery = useQuery({
    queryKey: ['module-graph-workflow-folders'],
    queryFn: () => getGraphWorkflowFolders(),
  })

  const graphExecutionsQuery = useQuery({
    queryKey: ['module-graph-executions', selectedGraphId],
    queryFn: () => getGraphWorkflowExecutions(selectedGraphId as number),
    enabled: selectedGraphId !== null,
    refetchInterval: (query) => {
      const records = (query.state.data as GraphExecutionRecord[] | undefined) ?? []
      return records.some((record) => record.status === 'queued' || record.status === 'running') ? 1500 : false
    },
  })

  const executionDetailQuery = useQuery({
    queryKey: ['module-graph-execution-detail', selectedExecutionId],
    queryFn: () => getGraphExecution(selectedExecutionId as number),
    enabled: selectedExecutionId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.execution.status
      return status === 'queued' || status === 'running' ? 1500 : false
    },
  })

  const modules = modulesQuery.data ?? []
  const executionList = graphExecutionsQuery.data ?? []

  useEffect(() => {
    if (selectedGraphId === null) {
      setDraftWorkflowFolderId(selectedFolderId)
    }
  }, [selectedFolderId, selectedGraphId])

  const {
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
  } = useModuleGraphPageViewModel({
    workflowName,
    workflowDescription,
    nodes,
    edges,
    workflowExposedInputs,
    workflowView,
    lastSavedSnapshot,
    graphWorkflows: graphWorkflowsQuery.data ?? [],
    selectedGraphId,
    graphWorkflowFolders: graphWorkflowFoldersQuery.data ?? [],
    selectedFolderId,
    modules,
    executionList,
    selectedExecutionId,
    selectedNodeId,
    selectedEdgeId,
    executionDetail: executionDetailQuery.data,
    settings: settingsQuery.data,
    workflowRunInputValues,
  })

  const scrollToEditorSupportSection = useCallback((section: EditorSupportSectionKey, behavior: ScrollBehavior = 'smooth') => {
    setActiveEditorSupportSection(section)
    const target = editorSupportSectionRefs.current[section]
    if (!target) {
      return
    }

    target.scrollIntoView({ behavior, block: 'start' })
  }, [])

  const openEditorSupport = useCallback((section: EditorSupportSectionKey = 'setup') => {
    setIsEditorSupportOpen(true)
    setActiveEditorSupportSection(section)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToEditorSupportSection(section)
      })
    })
  }, [scrollToEditorSupportSection])

  const enterWorkflowEditor = useCallback((section: EditorSupportSectionKey = 'setup') => {
    setWorkflowView('edit')
    setActiveEditorSupportSection(section)
    setIsEditorSupportOpen(false)
  }, [])

  const focusValidationIssue = useCallback((issue: WorkflowValidationIssue) => {
    if (!issue.nodeId) {
      return
    }

    const focusNode = () => {
      const targetNode = nodes.find((node) => node.id === issue.nodeId)
      if (!targetNode) {
        return
      }

      setSelectedNodeId(targetNode.id)
      setSelectedEdgeId(null)
      setSelectedValidationPortKey(issue.portKey ?? null)
      openEditorSupport('validation')
      void reactFlow.setCenter(targetNode.position.x + 180, targetNode.position.y + 80, { zoom: 1.1, duration: 220 })
    }

    if (workflowView !== 'edit') {
      setWorkflowView('edit')
      requestAnimationFrame(() => requestAnimationFrame(focusNode))
      return
    }

    focusNode()
  }, [nodes, openEditorSupport, reactFlow, workflowView])

  useEffect(() => {
    if (workflowView !== 'edit') {
      setIsEditorSupportOpen(false)
    }
  }, [workflowView])

  useBeforeUnload(
    useCallback((event) => {
      if (!shouldBlockGraphExit) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }, [shouldBlockGraphExit]),
  )

  const graphExitBlocker = useBlocker(useCallback(() => shouldBlockGraphExit, [shouldBlockGraphExit]))

  useEffect(() => {
    if (graphExitBlocker.state !== 'blocked') {
      return
    }

    if (window.confirm(UNSAVED_CHANGES_CONFIRM_MESSAGE)) {
      graphExitBlocker.proceed()
      return
    }

    graphExitBlocker.reset()
  }, [graphExitBlocker])

  useEffect(() => {
    if (selectedGraphId === null || executionList.length === 0) {
      return
    }

    const hasSelectedExecution = selectedExecutionId !== null && executionList.some((execution) => execution.id === selectedExecutionId)
    if (hasSelectedExecution) {
      return
    }

    setSelectedExecutionId(executionList[0].id)
  }, [executionList, selectedExecutionId, selectedGraphId])

  useEffect(() => {
    const exposedInputs = selectedGraphRecord?.graph.metadata?.exposed_inputs ?? []
    const nextInputValues = exposedInputs.reduce<Record<string, unknown>>((acc, inputDefinition) => {
      if (inputDefinition.default_value !== undefined) {
        acc[inputDefinition.id] = inputDefinition.default_value
      }
      return acc
    }, {})
    setWorkflowRunInputValues(nextInputValues)
  }, [selectedGraphRecord])

  useEffect(() => {
    const candidateMap = new Map(workflowInputCandidates.map((candidate) => [candidate.id, candidate]))
    setWorkflowExposedInputs((current) =>
      current
        .filter((inputDefinition) => candidateMap.has(inputDefinition.id))
        .map((inputDefinition) => {
          const candidate = candidateMap.get(inputDefinition.id) as GraphWorkflowExposedInput
          return {
            ...candidate,
            ...inputDefinition,
            id: candidate.id,
            node_id: candidate.node_id,
            port_key: candidate.port_key,
            data_type: candidate.data_type,
            ui_data_type: candidate.ui_data_type,
            options: candidate.options,
            module_id: candidate.module_id,
            module_name: candidate.module_name,
          }
        }),
    )
  }, [workflowInputCandidates])

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
      .map(([nodeId, preview]) => `${nodeId}:${preview.executionArtifactCount}:${preview.latestArtifactLabel ?? ''}:${preview.latestArtifactPreviewUrl ?? ''}:${preview.latestArtifactTextPreview ?? ''}`)
      .join('|')
    const edgeSignature = edges
      .map((edge) => `${edge.id}:${edge.source}:${edge.sourceHandle ?? ''}:${edge.target}:${edge.targetHandle ?? ''}`)
      .join('|')

    if (!executionDetailQuery.data) {
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
              connectedInputKeys: Array.from(connectedInputMap.get(node.id) ?? []),
              connectedOutputKeys: Array.from(connectedOutputMap.get(node.id) ?? []),
            },
          }
        }),
      )
      return
    }

    const executionPlan = executionDetailQuery.data.execution.execution_plan
      ? JSON.parse(executionDetailQuery.data.execution.execution_plan) as { orderedNodeIds?: string[]; reusedNodeIds?: string[] }
      : { orderedNodeIds: [] }

    const orderedNodeIds = executionPlan.orderedNodeIds ?? []
    const reusedNodeIds = new Set(executionPlan.reusedNodeIds ?? [])
    const artifactsByNode = executionDetailQuery.data.artifacts.reduce<Record<string, GraphExecutionArtifactRecord[]>>((acc, artifact) => {
      if (!acc[artifact.node_id]) {
        acc[artifact.node_id] = []
      }

      acc[artifact.node_id].push(artifact)
      return acc
    }, {})
    const artifactNodeIds = new Set(Object.keys(artifactsByNode))
    const executionArtifactSignature = executionDetailQuery.data.artifacts
      .map((artifact) => `${artifact.id}:${artifact.node_id}:${artifact.port_key}:${artifact.artifact_type}:${artifact.storage_path ?? ''}:${artifact.created_date}`)
      .join('|')
    const executionPlanSignature = `${executionDetailQuery.data.execution.id}:${executionDetailQuery.data.execution.status}:${executionDetailQuery.data.execution.failed_node_id ?? ''}:${executionDetailQuery.data.execution.updated_date}:${orderedNodeIds.join(',')}:${Array.from(reusedNodeIds).join(',')}`
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
            }
        const selectedExecutionStatus = getNodeExecutionStatus({
          nodeId: node.id,
          orderedNodeIds,
          artifactNodeIds,
          executionStatus: executionDetailQuery.data.execution.status,
          failedNodeId: executionDetailQuery.data.execution.failed_node_id,
        })
        const executionStatus = nodeArtifacts.length > 0 || orderedNodeIds.includes(node.id)
          ? selectedExecutionStatus
          : fallbackPreview
            ? 'completed'
            : 'idle'

        return {
          ...node,
          data: {
            ...node.data,
            executionStatus,
            executionArtifactCount: nodeArtifacts.length > 0 ? nodeArtifacts.length : (fallbackPreview?.executionArtifactCount ?? 0),
            latestArtifactLabel: artifactPreview.latestArtifactLabel,
            latestArtifactPreviewUrl: artifactPreview.latestArtifactPreviewUrl,
            latestArtifactTextPreview: artifactPreview.latestArtifactTextPreview,
            executionReuseState: reusedNodeIds.has(node.id) ? 'reused' : null,
            connectedInputKeys: Array.from(connectedInputMap.get(node.id) ?? []),
            connectedOutputKeys: Array.from(connectedOutputMap.get(node.id) ?? []),
          },
        }
      }),
    )
  }, [edges, executionDetailQuery.data, latestArtifactPreviewByNode, setNodes])

  const isValidConnection = useCallback(
    (edgeOrConnection: Connection | ModuleGraphEdge) => {
      const connection = edgeOrConnection as Connection

      if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
        return false
      }

      if (connection.source === connection.target) {
        return false
      }

      const sourceNode = nodes.find((node) => node.id === connection.source)
      const targetNode = nodes.find((node) => node.id === connection.target)
      if (!sourceNode || !targetNode) {
        return false
      }

      const sourceHandle = parseHandleId(connection.sourceHandle)
      const targetHandle = parseHandleId(connection.targetHandle)
      if (!sourceHandle || !targetHandle) {
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

  const handleConnect = useCallback(
    (connection: Connection) => {
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
    },
    [isValidConnection, setEdges, showSnackbar],
  )

  const handleAddModuleNode = (module: ModuleDefinitionRecord) => {
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
  }

  const handleAddModuleFromLibrary = (module: ModuleDefinitionRecord) => {
    handleAddModuleNode(module)
    setIsModuleLibraryOpen(false)
  }

  /** Confirm before replacing or clearing unsaved graph edits. */
  const confirmDiscardUnsavedChanges = () => {
    if (!isDirty) {
      return true
    }

    return window.confirm(UNSAVED_CHANGES_CONFIRM_MESSAGE)
  }

  const resetWorkflowDraft = () => {
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
  }

  const {
    handleLoadGraph,
    handleCreateWorkflow,
    handleCreateWorkflowFolder,
    handleUpdateSelectedFolder,
    handleDeleteSelectedFolder,
    handleConfirmDeleteFolder,
    handleAssignSelectedWorkflowFolder,
    handleEditSelectedWorkflow,
    handleDeleteSelectedWorkflow,
    handleLeaveWorkflowEditor,
    handleRefreshWorkspace: handleRefreshBrowseWorkspace,
  } = useModuleGraphBrowseActions({
    isDirty,
    selectedFolderId,
    selectedFolderRecord,
    selectedGraphRecord,
    folderDeleteTarget,
    workflowView,
    modules,
    graphWorkflowFolders: graphWorkflowFoldersQuery.data ?? [],
    setNodes,
    setEdges,
    setSelectedFolderId,
    setDraftWorkflowFolderId,
    setSelectedGraphId,
    setSelectedExecutionId,
    setSelectedNodeId,
    setSelectedEdgeId,
    setWorkflowName,
    setWorkflowDescription,
    setWorkflowExposedInputs,
    setWorkflowRunInputValues,
    setLastSavedSnapshot,
    setWorkflowView,
    setIsEditorSupportOpen,
    setActiveEditorSupportSection,
    setIsBrowseManageModalOpen,
    setFolderDeleteTarget,
    refetchGraphWorkflowFolders: graphWorkflowFoldersQuery.refetch,
    refetchGraphWorkflows: graphWorkflowsQuery.refetch,
    confirmDiscardUnsavedChanges,
    resetWorkflowDraft,
    enterWorkflowEditor,
    showSnackbar,
  })

  const handleDuplicateSelectedNode = () => {
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
  }

  const handleNodeValueChange = (nodeId: string, portKey: string, value: unknown) => {
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
  }

  const handleNodeValueClear = (nodeId: string, portKey: string) => {
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
  }

  const handleNodeImageChange = async (nodeId: string, portKey: string, image?: SelectedImageDraft) => {
    if (!image) {
      handleNodeValueClear(nodeId, portKey)
      return
    }

    handleNodeValueChange(nodeId, portKey, image.dataUrl)
  }

  const handleWorkflowRunInputChange = (inputId: string, value: unknown) => {
    setWorkflowRunInputValues((current) => ({
      ...current,
      [inputId]: value,
    }))
  }

  const handleWorkflowRunInputClear = (inputId: string) => {
    setWorkflowRunInputValues((current) => {
      const nextValues = { ...current }
      delete nextValues[inputId]
      return nextValues
    })
  }

  const handleWorkflowRunInputImageChange = async (inputId: string, image?: SelectedImageDraft) => {
    if (!image) {
      handleWorkflowRunInputClear(inputId)
      return
    }

    handleWorkflowRunInputChange(inputId, image.dataUrl)
  }

  const handleToggleWorkflowExposedInput = (inputDefinition: GraphWorkflowExposedInput) => {
    setWorkflowExposedInputs((current) => {
      const alreadySelected = current.some((item) => item.id === inputDefinition.id)
      if (alreadySelected) {
        return current.filter((item) => item.id !== inputDefinition.id)
      }

      return [...current, inputDefinition]
    })
  }

  const handleUpdateWorkflowExposedInput = (inputId: string, patch: Partial<GraphWorkflowExposedInput>) => {
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
  }

  const handleMoveWorkflowExposedInput = (inputId: string, direction: 'up' | 'down') => {
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
  }

  const handleWorkflowExposedInputDefaultImageChange = async (inputId: string, image?: SelectedImageDraft) => {
    if (!image) {
      handleUpdateWorkflowExposedInput(inputId, { default_value: undefined })
      return
    }

    handleUpdateWorkflowExposedInput(inputId, { default_value: image.dataUrl })
  }

  const {
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
  } = useModuleGraphExecutionActions({
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
    onWorkflowNameResolved: setWorkflowName,
    onGraphSelected: setSelectedGraphId,
    onExecutionSelected: setSelectedExecutionId,
    onNodeSelected: setSelectedNodeId,
    onEdgeCleared: () => setSelectedEdgeId(null),
    onSnapshotSaved: setLastSavedSnapshot,
    refetchGraphWorkflows: graphWorkflowsQuery.refetch,
    refetchGraphExecutions: graphExecutionsQuery.refetch,
    refetchExecutionDetail: executionDetailQuery.refetch,
    showSnackbar,
  })

  const handleRefreshWorkspace = () =>
    Promise.all([
      modulesQuery.refetch(),
      handleRefreshBrowseWorkspace(selectedGraphId !== null ? graphExecutionsQuery.refetch : undefined),
    ])

  const handleAutoLayout = () => {
    if (nodes.length === 0) {
      return
    }

    setNodes((currentNodes) => buildAutoLayoutedNodes(currentNodes, edges))
    requestAnimationFrame(() => {
      void reactFlow.fitView({ padding: 0.2, duration: 200 })
    })
    showSnackbar({ message: '그래프를 자동 정렬했어.', tone: 'info' })
  }

  const handleRemoveSelectedNode = () => {
    if (!selectedNodeId) {
      return
    }

    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId))
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId))
    setWorkflowExposedInputs((current) => current.filter((inputDefinition) => inputDefinition.node_id !== selectedNodeId))
    setSelectedNodeId(null)
  }

  const handleRemoveSelectedEdge = () => {
    if (!selectedEdgeId) {
      return
    }

    setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdgeId))
    setSelectedEdgeId(null)
  }

  const handleResetCanvas = () => {
    if (!confirmDiscardUnsavedChanges()) {
      return
    }

    resetWorkflowDraft()
  }

  const nodeTypes = useMemo(() => ({ module: ModuleGraphNodeCard }), [])
  const graphCanvasNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          executeNodeDisabled: executingGraphId !== null,
          onExecuteNode: () => void handleExecuteNodeById(node.id, false),
          onForceExecuteNode: () => void handleExecuteNodeById(node.id, true),
        },
      })),
    [executingGraphId, handleExecuteNodeById, isDirty, nodes, selectedGraphId],
  )

  const browseManageModalTitle = selectedGraphRecord
    ? '워크플로우 설정'
    : selectedFolderRecord
      ? '폴더 설정'
      : '폴더 생성'

  const workflowListSidebar = (
    <SavedGraphList
      graphs={graphWorkflowsQuery.data ?? []}
      folders={graphWorkflowFoldersQuery.data ?? []}
      selectedGraphId={selectedGraphId}
      selectedFolderId={selectedFolderId}
      moduleDefinitionById={moduleDefinitionById}
      onLoadGraph={(graph) => {
        void handleLoadGraph(graph, { silent: true })
      }}
      onSelectFolder={(folderId) => {
        setSelectedFolderId(folderId)
        if (workflowView === 'browse') {
          setSelectedGraphId(null)
          setSelectedExecutionId(null)
        }
      }}
      floatingActionContainerClassName={workflowView === 'edit' ? 'bottom-24' : undefined}
      leftToolbar={
        workflowView === 'edit' ? (
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="bg-surface-low"
            onClick={() => {
              handleLeaveWorkflowEditor()
            }}
            aria-label="목록으로"
            title="목록으로"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null
      }
      rightToolbar={(
        <>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="bg-surface-low"
            onClick={() => void handleRefreshWorkspace()}
            aria-label="새로고침"
            title="새로고침"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {workflowView === 'browse' && !selectedGraphRecord ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={() => setIsBrowseManageModalOpen(true)}
              aria-label={browseManageModalTitle}
              title={browseManageModalTitle}
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="bg-surface-low"
            onClick={handleCreateWorkflow}
            aria-label="새 워크플로우"
            title="새 워크플로우"
          >
            <Plus className="h-4 w-4" />
          </Button>
          {workflowView === 'browse' && selectedGraphRecord ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={handleEditSelectedWorkflow}
              aria-label="워크플로우 편집"
              title="워크플로우 편집"
            >
              <PenSquare className="h-4 w-4" />
            </Button>
          ) : null}
          {workflowView === 'browse' && selectedGraphRecord ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={() => void handleDeleteSelectedWorkflow()}
              aria-label="워크플로우 삭제"
              title="워크플로우 삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
          {workflowView === 'browse' && !selectedGraphRecord && selectedFolderRecord ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={() => {
                void handleDeleteSelectedFolder(selectedFolderRecord.id)
              }}
              aria-label="폴더 삭제"
              title="폴더 삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </>
      )}
    />
  )

  const editorSupportSubtitle = (
    <ModuleGraphEditorSupportSubtitle
      activeSection={activeEditorSupportSection}
      onSelectSection={scrollToEditorSupportSection}
    />
  )

  const workflowSetupFolderPanel = (
    <ModuleGraphWorkflowSetupFolderPanel
      folders={graphWorkflowFoldersQuery.data ?? []}
      draftWorkflowFolderId={draftWorkflowFolderId}
      draftChildFolderName={draftChildFolderName}
      draftChildFolderDescription={draftChildFolderDescription}
      onSelectFolder={setDraftWorkflowFolderId}
      onSelectRoot={() => setDraftWorkflowFolderId(null)}
      onDraftChildFolderNameChange={setDraftChildFolderName}
      onDraftChildFolderDescriptionChange={setDraftChildFolderDescription}
      onCreateChildFolder={() => {
        void handleCreateWorkflowFolder({
          name: draftChildFolderName,
          description: draftChildFolderDescription,
          parent_id: draftWorkflowFolderId,
        }).then(() => {
          setDraftChildFolderName('')
          setDraftChildFolderDescription('')
        })
      }}
    />
  )

  const workflowBrowseSidePanel = (
    <ModuleGraphWorkflowBrowseSidePanel
      selectedGraphRecord={selectedGraphRecord}
      workflowRunInputValues={workflowRunInputValues}
      isExecuting={executingGraphId !== null}
      latestExecution={latestExecution}
      latestExecutionDetail={latestExecutionDetail}
      selectedWorkflowCanExecute={selectedWorkflowCanExecute}
      selectedWorkflowValidationIssues={selectedWorkflowValidationIssues}
      onInputValueChange={handleWorkflowRunInputChange}
      onInputValueClear={handleWorkflowRunInputClear}
      onInputImageChange={handleWorkflowRunInputImageChange}
      onExecute={() => void handleRunSelectedWorkflow()}
      onEdit={handleEditSelectedWorkflow}
      onDeleteWorkflow={() => void handleDeleteSelectedWorkflow()}
      onOpenFolderSettings={() => setIsBrowseManageModalOpen(true)}
      onValidationIssueSelect={focusValidationIssue}
    />
  )

  const workflowEditorSupportPanels = (
    <ModuleGraphWorkflowEditorSupportPanels
      nodes={nodes}
      edges={edges}
      selectedGraphId={selectedGraphId}
      selectedGraphRecord={selectedGraphRecord}
      workflowName={workflowName}
      workflowDescription={workflowDescription}
      isDirty={isDirty}
      selectedNode={selectedNode}
      selectedEdge={selectedEdge}
      selectedExecutionId={selectedExecutionId}
      isSavingGraph={isSavingGraph}
      executingGraphId={executingGraphId}
      cancellingExecutionId={cancellingExecutionId}
      workflowInputCandidates={workflowInputCandidates}
      workflowExposedInputs={workflowExposedInputs}
      editorValidationIssues={editorValidationIssues}
      executionList={executionList}
      executionListError={graphExecutionsQuery.error instanceof Error ? graphExecutionsQuery.error.message : '실행 목록을 불러오지 못했어.'}
      executionListIsError={graphExecutionsQuery.isError}
      executionDetail={executionDetailQuery.data}
      executionDetailError={executionDetailQuery.error instanceof Error ? executionDetailQuery.error.message : '실행 상세를 불러오지 못했어.'}
      executionDetailIsError={executionDetailQuery.isError}
      selectedExecutionStatus={selectedExecution?.status ?? null}
      highlightedPortKey={selectedValidationPortKey}
      folderPanel={workflowSetupFolderPanel}
      onWorkflowNameChange={setWorkflowName}
      onWorkflowDescriptionChange={setWorkflowDescription}
      onSaveGraph={() => void handleSaveGraph()}
      setSectionRef={(section, node) => {
        editorSupportSectionRefs.current[section] = node
      }}
      onNodeValueChange={handleNodeValueChange}
      onNodeValueClear={handleNodeValueClear}
      onNodeImageChange={handleNodeImageChange}
      onExecuteSelectedNode={() => void handleExecuteSelectedNode(false)}
      onForceExecuteSelectedNode={() => void handleExecuteSelectedNode(true)}
      onToggleInput={handleToggleWorkflowExposedInput}
      onUpdateInput={handleUpdateWorkflowExposedInput}
      onMoveInput={handleMoveWorkflowExposedInput}
      onChangeDefaultImage={handleWorkflowExposedInputDefaultImageChange}
      onValidationIssueSelect={focusValidationIssue}
      onSelectExecution={(executionId) => {
        setSelectedExecutionId(executionId)
        openEditorSupport('results')
      }}
      onRerunGraph={() => void handleRerunSelectedGraph()}
      onRetryExecution={() => void handleRetrySelectedExecution()}
      onCancelExecution={() => void handleCancelSelectedExecution()}
    />
  )

  return (
    <div className="space-y-8">
      {!embedded ? (
        <PageHeader
          eyebrow="Create"
          title={workflowView === 'browse' ? 'Workflow' : 'Workflow Editor'}
        />
      ) : null}

      {workflowView === 'browse' ? (
        <ModuleWorkflowBrowseView
          isDesktopPageLayout={isDesktopPageLayout}
          workflowListSidebar={workflowListSidebar}
          workflowRunnerPanel={workflowBrowseSidePanel}
          graphExecutionPanel={selectedGraphRecord ? (
            <GraphExecutionPanel
              selectedGraphId={selectedGraphId}
              selectedGraph={selectedGraphRecord}
              selectedExecutionId={selectedExecutionId}
              selectedExecutionStatus={selectedExecution?.status ?? null}
              executionList={executionList}
              executionListError={graphExecutionsQuery.error instanceof Error ? graphExecutionsQuery.error.message : '실행 목록을 불러오지 못했어.'}
              executionListIsError={graphExecutionsQuery.isError}
              executionDetail={executionDetailQuery.data}
              executionDetailError={executionDetailQuery.error instanceof Error ? executionDetailQuery.error.message : '실행 상세를 불러오지 못했어.'}
              executionDetailIsError={executionDetailQuery.isError}
              isExecutingGraph={executingGraphId !== null}
              isCancellingExecution={cancellingExecutionId === selectedExecutionId}
              onSelectExecution={setSelectedExecutionId}
              onRerunGraph={() => void handleRerunSelectedGraph()}
              onRetryExecution={() => void handleRetrySelectedExecution()}
              onCancelExecution={() => void handleCancelSelectedExecution()}
            />
          ) : null}
        />
      ) : (
        <ModuleWorkflowEditorView
          isDesktopPageLayout={isDesktopPageLayout}
          workflowListSidebar={workflowListSidebar}
          nodesCount={nodes.length}
          edgesCount={edges.length}
          hasSelectedNode={Boolean(selectedNode)}
          hasSelectedEdge={Boolean(selectedEdge)}
          onOpenModuleLibrary={() => setIsModuleLibraryOpen(true)}
          onAutoLayout={handleAutoLayout}
          onDuplicateSelectedNode={handleDuplicateSelectedNode}
          onRemoveSelectedNode={handleRemoveSelectedNode}
          onRemoveSelectedEdge={handleRemoveSelectedEdge}
          onResetCanvas={handleResetCanvas}
          onOpenEditorSupport={() => openEditorSupport(selectedNode ? 'inspector' : selectedExecutionId ? 'results' : 'setup')}
          onCloseEditorSupport={() => setIsEditorSupportOpen(false)}
          isEditorSupportOpen={isEditorSupportOpen}
          editorSupportTitle={selectedGraphRecord?.name || workflowName || 'Workflow Draft'}
          editorSupportSubtitle={editorSupportSubtitle}
          workflowEditorSupportPanels={workflowEditorSupportPanels}
          graphCanvas={
            <div className="h-[760px] overflow-hidden rounded-sm border border-border bg-surface-lowest">
              <ReactFlow
                className="theme-graph-flow"
                nodes={graphCanvasNodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => {
                  setSelectedNodeId(node.id)
                  setSelectedEdgeId(null)
                  setSelectedValidationPortKey(null)
                }}
                onEdgeClick={(_, edge) => {
                  setSelectedEdgeId(edge.id)
                  setSelectedNodeId(null)
                  setSelectedValidationPortKey(null)
                }}
                onPaneClick={() => {
                  setSelectedNodeId(null)
                  setSelectedEdgeId(null)
                  setSelectedValidationPortKey(null)
                }}
                onConnect={handleConnect}
                isValidConnection={isValidConnection}
                nodeTypes={nodeTypes}
                fitView
                colorMode={reactFlowColorMode}
                snapToGrid
                connectionRadius={32}
                deleteKeyCode={['Backspace', 'Delete']}
                defaultMarkerColor="var(--foreground)"
                defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
              >
                <MiniMap
                  pannable
                  zoomable
                  nodeColor="var(--primary)"
                  maskColor="color-mix(in srgb, var(--background) 72%, transparent)"
                  className="!bg-surface-lowest"
                />
                <Controls />
                <Background gap={20} size={1} color="color-mix(in srgb, var(--foreground) 10%, transparent)" />
              </ReactFlow>
            </div>
          }
        />
      )}

      <SettingsModal
        open={workflowView === 'browse' && isBrowseManageModalOpen}
        title={browseManageModalTitle}
        onClose={() => setIsBrowseManageModalOpen(false)}
        widthClassName="max-w-3xl"
      >
        <WorkflowFolderSettingsPanel
          key={selectedGraphRecord ? `workflow-${selectedGraphRecord.id}` : selectedFolderRecord ? `folder-${selectedFolderRecord.id}` : 'root'}
          folders={graphWorkflowFoldersQuery.data ?? []}
          selectedFolder={selectedFolderRecord}
          selectedWorkflow={selectedGraphRecord}
          showHeader={false}
          onAssignWorkflowFolder={(folderId) => handleAssignSelectedWorkflowFolder(folderId)}
          onCreateFolder={(input) => handleCreateWorkflowFolder(input)}
          onUpdateFolder={(folderId, input) => handleUpdateSelectedFolder(folderId, input)}
          onDeleteFolder={(folderId) => handleDeleteSelectedFolder(folderId)}
          onEditWorkflow={() => {
            setIsBrowseManageModalOpen(false)
            handleEditSelectedWorkflow()
          }}
          onDeleteWorkflow={async () => {
            await handleDeleteSelectedWorkflow()
            setIsBrowseManageModalOpen(false)
          }}
        />
      </SettingsModal>

      <SettingsModal
        open={folderDeleteTarget !== null}
        title="폴더 삭제"
        onClose={() => setFolderDeleteTarget(null)}
        widthClassName="max-w-xl"
      >
        <div className="space-y-4">
          <Alert>
            <AlertTitle>{folderDeleteTarget ? `"${folderDeleteTarget.name}" 폴더를 어떻게 삭제할지 골라줘.` : '폴더 삭제'}</AlertTitle>
            <AlertDescription>
              <div>원하는 정리 방식을 선택하면 돼.</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>폴더만 삭제: 하위 폴더와 워크플로우를 상위 폴더로 올림</li>
                <li>내용 포함 삭제: 하위 폴더와 그 안의 워크플로우까지 함께 삭제</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFolderDeleteTarget(null)}>
              취소
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleConfirmDeleteFolder('move_children')}>
              폴더만 삭제
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleConfirmDeleteFolder('delete_tree')}>
              내용 포함 삭제
            </Button>
          </div>
        </div>
      </SettingsModal>

      <SettingsModal
        open={isModuleLibraryOpen}
        title="모듈 추가"
        description="사용자 모듈과 시스템 모듈을 나눠 보고, 필요한 항목을 바로 그래프에 추가해."
        onClose={() => setIsModuleLibraryOpen(false)}
        widthClassName="max-w-6xl"
      >
        <ModuleLibraryPanel
          modules={modules}
          isError={modulesQuery.isError}
          errorMessage={modulesQuery.error instanceof Error ? modulesQuery.error.message : '모듈 목록을 불러오지 못했어.'}
          onAddModule={handleAddModuleFromLibrary}
          surface="plain"
        />
      </SettingsModal>
    </div>
  )
}

export function ModuleWorkflowWorkspace({ embedded = false }: ModuleWorkflowWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <ModuleWorkflowWorkspaceInner embedded={embedded} />
    </ReactFlowProvider>
  )
}

export function ModuleGraphPage() {
  return <ModuleWorkflowWorkspace />
}

