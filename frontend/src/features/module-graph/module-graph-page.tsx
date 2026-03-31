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
import { ArrowLeft, Boxes, ChevronDown, Copy, Plus, RefreshCw, RotateCcw, Save, Trash2, Unplug, Workflow } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/common/page-header'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  cancelGraphExecution,
  createGraphWorkflow,
  executeGraphWorkflow,
  getAppSettings,
  getGraphExecution,
  getGraphWorkflowExecutions,
  getGraphWorkflows,
  getModuleDefinitions,
  updateGraphWorkflow,
  type GraphExecutionRecord,
  type GraphWorkflowExposedInput,
  type GraphWorkflowRecord,
  type ModuleDefinitionRecord,
} from '@/lib/api'
import { GraphExecutionPanel } from './components/graph-execution-panel'
import { ModuleGraphNodeCard } from './components/module-graph-node-card'
import { ModuleLibraryPanel } from './components/module-library-panel'
import { NodeInspectorPanel } from './components/node-inspector-panel'
import { SavedGraphList } from './components/saved-graph-list'
import { WorkflowExposedInputEditor } from './components/workflow-exposed-input-editor'
import { WorkflowRunnerPanel } from './components/workflow-runner-panel'
import { WorkflowValidationPanel, type WorkflowValidationIssue } from './components/workflow-validation-panel'
import {
  buildAutoLayoutedNodes,
  buildFlowFromGraphRecord,
  buildGraphEditorSnapshot,
  buildGraphPayload,
  buildModuleEdgePresentation,
  findNodePort,
  getArtifactPreviewUrl,
  getModulePortCompatibility,
  getNodeExecutionStatus,
  parseHandleId,
  readFileAsDataUrl,
  type ModuleGraphEdge,
  type ModuleGraphNode,
} from './module-graph-shared'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import type { AppSettings } from '@/types/settings'

type ModuleWorkflowWorkspaceProps = {
  embedded?: boolean
}

function buildWorkflowExposedInputId(nodeId: string, portKey: string) {
  return `${nodeId}:${portKey}`
}

type ValidationNodeRecord = {
  id: string
  module: ModuleDefinitionRecord | null
  inputValues: Record<string, unknown>
}

type ValidationEdgeRecord = {
  targetNodeId: string
  targetPortKey: string
}

function hasMeaningfulValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

function resolveSystemCapabilityIssue(module: ModuleDefinitionRecord, settings?: AppSettings | null) {
  if (module.engine_type !== 'system' || !settings) {
    return null
  }

  const operationKey = typeof module.internal_fixed_values?.operation_key === 'string'
    ? module.internal_fixed_values.operation_key
    : typeof module.template_defaults?.operation_key === 'string'
      ? module.template_defaults.operation_key
      : null

  if (operationKey === 'system.extract_tags_from_image' && !settings.tagger.enabled) {
    return 'WD Tagger 기능이 비활성화돼 있어.'
  }

  if (operationKey === 'system.extract_artist_from_image' && !settings.kaloscope.enabled) {
    return 'Kaloscope 기능이 비활성화돼 있어.'
  }

  return null
}

function buildWorkflowValidationIssues(params: {
  nodes: ValidationNodeRecord[]
  edges: ValidationEdgeRecord[]
  exposedInputs: GraphWorkflowExposedInput[]
  runtimeInputValues?: Record<string, unknown>
  settings?: AppSettings | null
}) {
  const { nodes, edges, exposedInputs, runtimeInputValues = {}, settings } = params
  const issues: WorkflowValidationIssue[] = []
  const connectedInputMap = new Map<string, Set<string>>()
  const exposedInputMap = new Map(exposedInputs.map((inputDefinition) => [buildWorkflowExposedInputId(inputDefinition.node_id, inputDefinition.port_key), inputDefinition]))

  for (const edge of edges) {
    const current = connectedInputMap.get(edge.targetNodeId) ?? new Set<string>()
    current.add(edge.targetPortKey)
    connectedInputMap.set(edge.targetNodeId, current)
  }

  for (const node of nodes) {
    const nodeLabel = node.module?.name ?? '알 수 없는 모듈'

    if (!node.module) {
      issues.push({
        id: `missing-module:${node.id}`,
        nodeId: node.id,
        nodeLabel,
        severity: 'error',
        title: '모듈 정의를 찾지 못했어',
        detail: '이 노드가 참조하는 모듈이 현재 목록에 없어. 저장된 워크플로우와 모듈 카탈로그를 확인해봐.',
      })
      continue
    }

    const capabilityIssue = resolveSystemCapabilityIssue(node.module, settings)
    if (capabilityIssue) {
      issues.push({
        id: `capability:${node.id}`,
        nodeId: node.id,
        nodeLabel,
        severity: 'error',
        title: '시스템 기능이 비활성화돼 있어',
        detail: capabilityIssue,
      })
    }

    const connectedInputKeys = connectedInputMap.get(node.id) ?? new Set<string>()
    for (const port of node.module.exposed_inputs ?? []) {
      if (!port.required) {
        continue
      }

      const exposedInput = exposedInputMap.get(buildWorkflowExposedInputId(node.id, port.key))
      const runtimeValue = exposedInput ? runtimeInputValues[exposedInput.id] : undefined
      const satisfied = connectedInputKeys.has(port.key)
        || hasMeaningfulValue(node.inputValues?.[port.key])
        || hasMeaningfulValue(port.default_value)
        || hasMeaningfulValue(exposedInput?.default_value)
        || hasMeaningfulValue(runtimeValue)

      if (!satisfied) {
        issues.push({
          id: `missing-input:${node.id}:${port.key}`,
          nodeId: node.id,
          portKey: port.key,
          nodeLabel,
          severity: 'error',
          title: `필수 입력 누락 · ${port.label}`,
          detail: `${port.label} (${port.key}) 입력이 연결되지 않았고 값도 비어 있어.`,
        })
      }
    }
  }

  return issues
}

function ModuleWorkflowWorkspaceInner({ embedded = false }: ModuleWorkflowWorkspaceProps) {
  const { showSnackbar } = useSnackbar()
  const reactFlow = useReactFlow()
  const [workflowName, setWorkflowName] = useState('Workflow Draft')
  const [workflowDescription, setWorkflowDescription] = useState('')
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
  const [isSavingGraph, setIsSavingGraph] = useState(false)
  const [executingGraphId, setExecutingGraphId] = useState<number | null>(null)
  const [cancellingExecutionId, setCancellingExecutionId] = useState<number | null>(null)
  const [workflowView, setWorkflowView] = useState<'browse' | 'edit'>('browse')
  const [isModuleLibraryOpen, setIsModuleLibraryOpen] = useState(false)
  const [isSetupCollapsed, setIsSetupCollapsed] = useState(false)
  const [workflowExposedInputs, setWorkflowExposedInputs] = useState<GraphWorkflowExposedInput[]>([])
  const [workflowRunInputValues, setWorkflowRunInputValues] = useState<Record<string, unknown>>({})
  const previousExecutionStatusesRef = useRef<Record<number, GraphExecutionRecord['status']>>({})
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
  const currentSnapshot = useMemo(
    () =>
      buildGraphEditorSnapshot({
        name: workflowName,
        description: workflowDescription,
        nodes,
        edges,
        workflowMetadata: {
          exposed_inputs: workflowExposedInputs,
        },
      }),
    [edges, nodes, workflowDescription, workflowExposedInputs, workflowName],
  )
  const isDirty = currentSnapshot !== lastSavedSnapshot
  const selectedGraphRecord = useMemo(() => (graphWorkflowsQuery.data ?? []).find((graph) => graph.id === selectedGraphId) ?? null, [graphWorkflowsQuery.data, selectedGraphId])
  const moduleDefinitionById = useMemo(() => new Map(modules.map((module) => [module.id, module])), [modules])
  const workflowInputCandidates = useMemo(
    () =>
      nodes.flatMap((node) =>
        node.data.module.exposed_inputs.map((port) => ({
          id: buildWorkflowExposedInputId(node.id, port.key),
          node_id: node.id,
          port_key: port.key,
          label: `${node.data.module.name} · ${port.label}`,
          data_type: port.data_type,
          description: port.description,
          required: port.required,
          placeholder: port.description || port.label,
          default_value: port.default_value,
          module_id: node.data.module.id,
          module_name: node.data.module.name,
        })),
      ),
    [nodes],
  )
  const latestExecution = executionList[0] ?? null
  const latestExecutionPreviewArtifact = useMemo(() => {
    if (!latestExecution || executionDetailQuery.data?.execution.id !== latestExecution.id) {
      return null
    }

    return executionDetailQuery.data.artifacts.find((artifact) => artifact.artifact_type === 'image' || artifact.artifact_type === 'mask') ?? null
  }, [executionDetailQuery.data, latestExecution])
  const selectedExecution = useMemo(() => executionList.find((execution) => execution.id === selectedExecutionId) ?? executionDetailQuery.data?.execution ?? null, [executionDetailQuery.data?.execution, executionList, selectedExecutionId])
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
        exposedInputs: workflowExposedInputs,
        settings: settingsQuery.data,
      }),
    [edges, nodes, settingsQuery.data, workflowExposedInputs],
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
      settings: settingsQuery.data,
    })
  }, [moduleDefinitionById, selectedGraphRecord, settingsQuery.data, workflowRunInputValues])
  const selectedWorkflowCanExecute = selectedWorkflowValidationIssues.every((issue) => issue.severity !== 'error')

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
      void reactFlow.setCenter(targetNode.position.x + 180, targetNode.position.y + 80, { zoom: 1.1, duration: 220 })
    }

    if (workflowView !== 'edit') {
      setWorkflowView('edit')
      requestAnimationFrame(() => requestAnimationFrame(focusNode))
      return
    }

    focusNode()
  }, [nodes, reactFlow, workflowView])

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

    if (!executionDetailQuery.data) {
      setNodes((currentNodes) =>
        currentNodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            executionStatus: 'idle',
            executionArtifactCount: 0,
            connectedInputKeys: Array.from(connectedInputMap.get(node.id) ?? []),
            connectedOutputKeys: Array.from(connectedOutputMap.get(node.id) ?? []),
          },
        })),
      )
      return
    }

    const executionPlan = executionDetailQuery.data.execution.execution_plan
      ? JSON.parse(executionDetailQuery.data.execution.execution_plan) as { orderedNodeIds?: string[] }
      : { orderedNodeIds: [] }

    const orderedNodeIds = executionPlan.orderedNodeIds ?? []
    const artifactCounts = executionDetailQuery.data.artifacts.reduce<Record<string, number>>((acc, artifact) => {
      acc[artifact.node_id] = (acc[artifact.node_id] ?? 0) + 1
      return acc
    }, {})
    const artifactNodeIds = new Set(Object.keys(artifactCounts))

    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          executionStatus: getNodeExecutionStatus({
            nodeId: node.id,
            orderedNodeIds,
            artifactNodeIds,
            executionStatus: executionDetailQuery.data.execution.status,
            failedNodeId: executionDetailQuery.data.execution.failed_node_id,
          }),
          executionArtifactCount: artifactCounts[node.id] ?? 0,
          connectedInputKeys: Array.from(connectedInputMap.get(node.id) ?? []),
          connectedOutputKeys: Array.from(connectedOutputMap.get(node.id) ?? []),
        },
      })),
    )
  }, [edges, executionDetailQuery.data, setNodes])

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

    return window.confirm('저장하지 않은 변경사항이 있어. 이 작업을 진행하면 현재 편집 내용이 사라질 수 있어. 계속할까?')
  }

  const resetWorkflowDraft = () => {
    setNodes([])
    setEdges([])
    setSelectedGraphId(null)
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

  const handleLoadGraph = (graph: GraphWorkflowRecord, options?: { openEditor?: boolean; silent?: boolean }) => {
    if (!confirmDiscardUnsavedChanges()) {
      return false
    }

    const { nodes: nextNodes, edges: nextEdges } = buildFlowFromGraphRecord(graph, modules)
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedGraphId(graph.id)
    setSelectedExecutionId(null)
    setSelectedEdgeId(null)
    setSelectedNodeId(nextNodes[0]?.id ?? null)
    setWorkflowName(graph.name)
    setWorkflowDescription(graph.description || '')
    setWorkflowExposedInputs(graph.graph.metadata?.exposed_inputs ?? [])
    setLastSavedSnapshot(
      buildGraphEditorSnapshot({
        name: graph.name,
        description: graph.description || '',
        nodes: nextNodes,
        edges: nextEdges,
        workflowMetadata: {
          exposed_inputs: graph.graph.metadata?.exposed_inputs ?? [],
        },
      }),
    )
    if (options?.openEditor) {
      setWorkflowView('edit')
    }
    if (!options?.silent) {
      showSnackbar({ message: '저장된 워크플로우를 불러왔어.', tone: 'info' })
    }

    return true
  }

  const handleCreateWorkflow = () => {
    if (!confirmDiscardUnsavedChanges()) {
      return
    }

    resetWorkflowDraft()
    setWorkflowView('edit')
    showSnackbar({ message: '새 워크플로우 초안을 열었어.', tone: 'info' })
  }

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

  const handleNodeImageChange = async (nodeId: string, portKey: string, file?: File) => {
    if (!file) {
      handleNodeValueClear(nodeId, portKey)
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      handleNodeValueChange(nodeId, portKey, dataUrl)
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '이미지 파일을 읽지 못했어.', tone: 'error' })
    }
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

  const handleWorkflowRunInputImageChange = async (inputId: string, file?: File) => {
    if (!file) {
      handleWorkflowRunInputClear(inputId)
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      handleWorkflowRunInputChange(inputId, dataUrl)
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '이미지 파일을 읽지 못했어.', tone: 'error' })
    }
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

  const handleWorkflowExposedInputDefaultImageChange = async (inputId: string, file?: File) => {
    if (!file) {
      handleUpdateWorkflowExposedInput(inputId, { default_value: undefined })
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      handleUpdateWorkflowExposedInput(inputId, { default_value: dataUrl })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '이미지 파일을 읽지 못했어.', tone: 'error' })
    }
  }

  const handleSaveGraph = async () => {
    const name = workflowName.trim()
    if (name.length === 0 || isSavingGraph) {
      return
    }

    if (nodes.length === 0) {
      showSnackbar({ message: '저장할 노드를 먼저 하나 이상 배치해줘.', tone: 'error' })
      return
    }

    try {
      setIsSavingGraph(true)
      const payload = {
        name,
        description: workflowDescription.trim() || undefined,
        graph: buildGraphPayload(nodes, edges, {
          exposed_inputs: workflowExposedInputs,
        }),
      }

      if (selectedGraphId !== null) {
        await updateGraphWorkflow(selectedGraphId, payload)
        setLastSavedSnapshot(currentSnapshot)
        await graphWorkflowsQuery.refetch()
        showSnackbar({ message: '현재 그래프를 업데이트 저장했어.', tone: 'info' })
      } else {
        const saved = await createGraphWorkflow(payload)
        setSelectedGraphId(saved.id)
        setSelectedExecutionId(null)
        setLastSavedSnapshot(currentSnapshot)
        await graphWorkflowsQuery.refetch()
        showSnackbar({ message: '새 그래프 워크플로우를 저장했어.', tone: 'info' })
      }
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '그래프 저장에 실패했어.', tone: 'error' })
    } finally {
      setIsSavingGraph(false)
    }
  }

  const handleExecuteGraph = async (graphId: number, inputValues?: Record<string, unknown>) => {
    if (executingGraphId !== null) {
      return
    }

    try {
      setExecutingGraphId(graphId)
      setSelectedGraphId(graphId)
      const result = await executeGraphWorkflow(graphId, inputValues ? { input_values: inputValues } : undefined)
      setSelectedExecutionId(result.executionId)
      await graphExecutionsQuery.refetch()
      showSnackbar({
        message: `워크플로우 실행 요청을 등록했어. 실행 #${result.executionId}가 백그라운드 큐에서 처리돼.`,
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '워크플로우 실행에 실패했어.', tone: 'error' })
    } finally {
      setExecutingGraphId(null)
    }
  }

  const handleRunSelectedWorkflow = async () => {
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
  }

  const handleRerunSelectedGraph = async () => {
    if (selectedGraphId === null) {
      showSnackbar({ message: '먼저 그래프를 하나 불러와줘.', tone: 'error' })
      return
    }

    await handleExecuteGraph(selectedGraphId)
  }

  const handleCancelSelectedExecution = async () => {
    if (!selectedExecutionId) {
      showSnackbar({ message: '먼저 실행 하나를 선택해줘.', tone: 'error' })
      return
    }

    try {
      setCancellingExecutionId(selectedExecutionId)
      const result = await cancelGraphExecution(selectedExecutionId)
      await Promise.all([graphExecutionsQuery.refetch(), executionDetailQuery.refetch()])
      showSnackbar({ message: result.message, tone: result.success ? 'info' : 'error' })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '실행 취소에 실패했어.', tone: 'error' })
    } finally {
      setCancellingExecutionId(null)
    }
  }

  const handleRetrySelectedExecution = async () => {
    if (!selectedExecution || (selectedExecution.status !== 'failed' && selectedExecution.status !== 'cancelled')) {
      showSnackbar({ message: '실패하거나 취소된 실행을 먼저 선택해줘.', tone: 'error' })
      return
    }

    await handleExecuteGraph(selectedExecution.graph_workflow_id)
  }

  const handleRefreshWorkspace = () =>
    Promise.all([
      modulesQuery.refetch(),
      graphWorkflowsQuery.refetch(),
      ...(selectedGraphId !== null ? [graphExecutionsQuery.refetch()] : []),
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

  const workflowListSidebar = (
    <SavedGraphList
      graphs={graphWorkflowsQuery.data ?? []}
      selectedGraphId={selectedGraphId}
      executingGraphId={executingGraphId}
      onLoadGraph={(graph) => {
        void handleLoadGraph(graph, { silent: true })
      }}
      onEditGraph={(graph) => {
        void handleLoadGraph(graph, { openEditor: true, silent: true })
      }}
      onExecuteGraph={(graphId) => void handleExecuteGraph(graphId)}
      showExecuteButton={false}
      headerActions={
        workflowView === 'browse' ? (
          <div className="flex items-center gap-2">
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
            <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={handleCreateWorkflow} aria-label="새 워크플로우" title="새 워크플로우">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        ) : undefined
      }
      topToolbar={
        workflowView === 'edit' ? (
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={() => setWorkflowView('browse')}
              aria-label="목록으로"
              title="목록으로"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
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
          </>
        ) : undefined
      }
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
        <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[320px_minmax(0,1fr)]' : 'grid-cols-1')}>
          {workflowListSidebar}

          <div className="space-y-6">
            {selectedGraphRecord ? (
              <WorkflowRunnerPanel
                selectedGraph={selectedGraphRecord}
                inputDefinitions={selectedGraphRecord.graph.metadata?.exposed_inputs ?? []}
                inputValues={workflowRunInputValues}
                isExecuting={executingGraphId !== null}
                latestExecution={latestExecution}
                latestPreviewUrl={latestExecutionPreviewArtifact ? getArtifactPreviewUrl(latestExecutionPreviewArtifact) : null}
                latestPreviewLabel={latestExecutionPreviewArtifact ? `${latestExecutionPreviewArtifact.node_id} · ${latestExecutionPreviewArtifact.port_key}` : null}
                onInputValueChange={handleWorkflowRunInputChange}
                onInputValueClear={handleWorkflowRunInputClear}
                onInputImageChange={handleWorkflowRunInputImageChange}
                onExecute={() => void handleRunSelectedWorkflow()}
                onEdit={() => setWorkflowView('edit')}
                canExecute={selectedWorkflowCanExecute}
                validationIssues={selectedWorkflowValidationIssues}
                onValidationIssueSelect={focusValidationIssue}
              />
            ) : null}

            <GraphExecutionPanel
              selectedGraphId={selectedGraphId}
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
          </div>
        </div>
      ) : (
        <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[320px_minmax(0,1fr)]' : 'grid-cols-1')}>
          {workflowListSidebar}

          <div className="space-y-6">
            <Card>
              <CardContent className="space-y-4">
                <SectionHeading
                  variant="inside"
                  heading={
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Boxes className="h-4 w-4 text-primary" />
                      Workflow Graph
                    </span>
                  }
                  actions={
                    <>
                      <Badge variant="outline">노드 {nodes.length}</Badge>
                      <Badge variant="outline">엣지 {edges.length}</Badge>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => setIsModuleLibraryOpen(true)}
                        aria-label="모듈 추가"
                        title="모듈 추가"
                      >
                        <Boxes className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={handleAutoLayout}
                        disabled={nodes.length === 0}
                        aria-label="자동 정렬"
                        title="자동 정렬"
                      >
                        <Workflow className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={handleDuplicateSelectedNode}
                        disabled={!selectedNode}
                        aria-label="노드 복제"
                        title="노드 복제"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        className="ml-1 border-rose-500/30 text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
                        onClick={handleRemoveSelectedNode}
                        disabled={!selectedNode}
                        aria-label="노드 삭제"
                        title="노드 삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        className="border-rose-500/30 text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
                        onClick={handleRemoveSelectedEdge}
                        disabled={!selectedEdge}
                        aria-label="엣지 삭제"
                        title="엣지 삭제"
                      >
                        <Unplug className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        className="ml-2 border-amber-500/30 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
                        onClick={handleResetCanvas}
                        aria-label="초기화"
                        title="초기화"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    </>
                  }
                />

                <div className="h-[760px] overflow-hidden rounded-sm border border-border bg-surface-lowest">
                  <ReactFlow
                    className="theme-graph-flow"
                    nodes={nodes}
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
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4">
                <SectionHeading
                  variant="inside"
                  heading="Workflow Setup"
                  actions={
                    <>
                      <Badge variant="outline">N {nodes.length}</Badge>
                      <Badge variant="outline">E {edges.length}</Badge>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setIsSetupCollapsed((current) => !current)}>
                        <ChevronDown className={`h-4 w-4 transition-transform ${isSetupCollapsed ? '-rotate-90' : 'rotate-0'}`} />
                      </Button>
                    </>
                  }
                />

                {!isSetupCollapsed ? (
                  <>
                    <Alert>
                      <AlertTitle className="flex flex-wrap items-center gap-2">
                        <span>{selectedGraphRecord?.name || workflowName || 'Untitled workflow'}</span>
                        {selectedGraphRecord ? <Badge variant="outline">v{selectedGraphRecord.version}</Badge> : <Badge variant="outline">draft</Badge>}
                        {isDirty ? <Badge variant="outline">unsaved</Badge> : <Badge variant="secondary">saved</Badge>}
                      </AlertTitle>
                      <AlertDescription>
                        <div>노드 {nodes.length} · 엣지 {edges.length} · 노출 입력 {workflowExposedInputs.length}</div>
                      </AlertDescription>
                    </Alert>

                    <div className="grid gap-3">
                      <Input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} placeholder="Workflow name" />
                      <Input value={workflowDescription} onChange={(event) => setWorkflowDescription(event.target.value)} placeholder="설명 (선택)" />
                    </div>

                    <Button type="button" onClick={() => void handleSaveGraph()} disabled={isSavingGraph || workflowName.trim().length === 0}>
                      <Save className="h-4 w-4" />
                      {isSavingGraph ? '저장 중…' : selectedGraphId !== null ? '워크플로우 업데이트' : '워크플로우 저장'}
                    </Button>
                  </>
                ) : null}
              </CardContent>
            </Card>

            <NodeInspectorPanel
              nodes={nodes}
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              onNodeValueChange={handleNodeValueChange}
              onNodeValueClear={handleNodeValueClear}
              onNodeImageChange={handleNodeImageChange}
              highlightedPortKey={selectedValidationPortKey}
            />

            <WorkflowExposedInputEditor
              candidates={workflowInputCandidates}
              selectedInputs={workflowExposedInputs}
              onToggleInput={handleToggleWorkflowExposedInput}
              onUpdateInput={handleUpdateWorkflowExposedInput}
              onMoveInput={handleMoveWorkflowExposedInput}
              onChangeDefaultImage={handleWorkflowExposedInputDefaultImageChange}
            />

            <WorkflowValidationPanel
              issues={editorValidationIssues}
              title="Editor Validation"
              description="실행 전 확인"
              onIssueSelect={focusValidationIssue}
            />

            <GraphExecutionPanel
              selectedGraphId={selectedGraphId}
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
          </div>
        </div>
      )}

      <BottomDrawerSheet
        open={isModuleLibraryOpen}
        title="모듈 추가"
        subtitle="그래프에 넣을 모듈을 골라서 바로 추가해."
        onClose={() => setIsModuleLibraryOpen(false)}
        ariaLabel="모듈 추가 패널"
        className="max-w-5xl mx-auto"
        bodyClassName="p-4"
        closeLabel="닫기"
      >
        <ModuleLibraryPanel
          modules={modules}
          isError={modulesQuery.isError}
          errorMessage={modulesQuery.error instanceof Error ? modulesQuery.error.message : '모듈 목록을 불러오지 못했어.'}
          onAddModule={handleAddModuleFromLibrary}
          surface="plain"
        />
      </BottomDrawerSheet>
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

