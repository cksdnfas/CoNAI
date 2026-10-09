import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, MiniMap, ReactFlow, useNodesInitialized, type Connection, type OnConnectEnd, type OnConnectStart, type OnEdgesChange, type OnNodesChange, type ReactFlowInstance } from '@xyflow/react'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import type { ModuleDefinitionRecord } from '@/lib/api-module-graph'
import { useIsCoarsePointer } from '@/lib/use-is-coarse-pointer'
import { ModuleGraphActionMenu, type ModuleGraphActionMenuState } from './module-graph-action-menu'
import { ModuleGraphQuickCreateMenu, type RecommendedModuleMatch } from './module-graph-quick-create-menu'
import { ModuleGraphNodeCard } from './module-graph-node-card'
import { ModuleGraphEdgeView } from './module-graph-edge'
import {
  ModuleGraphCanvasContext,
  ModuleGraphExecutionLockContext,
  ModuleGraphNodeActionsContext,
  buildInputSourceKey,
  type ModuleGraphCanvasContextValue,
  type ModuleGraphConnectionDrag,
  type ModuleGraphLiftedLink,
  type ModuleGraphNodeActions,
} from './module-graph-canvas-context'
import {
  ADVANCED_OUTPUT_PORTS_ENABLED_KEY,
  buildHandleId,
  findNodePort,
  getModuleBaseDisplayName,
  getModuleNodeDisplayLabel,
  getModulePortCompatibility,
  getPortTypeColor,
  getVisibleModuleOutputPorts,
  hasAdvancedModuleOutputPorts,
  isAdvancedOutputPortsEnabled,
  parseHandleId,
  type ModuleGraphEdge,
  type ModuleGraphNode,
} from '../module-graph-shared'
import { getActiveModuleInputPorts } from '../module-graph-minimax-director-ports'
import { GRAPH_FIT_VIEW_OPTIONS, GRAPH_MIN_ZOOM } from '../module-graph-viewport'

export type { RecommendedModuleMatch } from './module-graph-quick-create-menu'

const MODULE_GRAPH_NODE_TYPES = { module: ModuleGraphNodeCard }
const MODULE_GRAPH_EDGE_TYPES = { module: ModuleGraphEdgeView }
const MOBILE_NODE_DRAG_HANDLE_SELECTOR = '.module-graph-drag-handle'
const INITIAL_GRAPH_VIEWPORT = { x: 0, y: 0, zoom: 0.85 }
const PRO_OPTIONS = { hideAttribution: true }
const DEFAULT_EDGE_OPTIONS = { type: 'module' }

type PendingConnectionStart = {
  nodeId: string
  handleId: string
  handleType: 'source' | 'target'
}

type QuickCreateState = {
  mode: 'pane' | 'connect'
  anchor: { x: number; y: number }
  /** `center` hangs the menu centered under the anchor (toolbar "+ node"); pointer opens use `start`. */
  align: 'start' | 'center'
  flowPosition: { x: number; y: number }
  connectionStart: PendingConnectionStart | null
}

type ActionMenuState = (ModuleGraphActionMenuState & { flowPosition: { x: number; y: number }; nodeId?: string })

/** What a node card can do, minus the menu the canvas opens itself. */
export type ModuleGraphCanvasNodeActions = Pick<ModuleGraphNodeActions, 'changeValue' | 'clearValue' | 'changeLabel' | 'changeImage' | 'execute' | 'editInPanel'>

/** Resolve one mouse/touch client point from graph-canvas interactions. */
function getEventClientPoint(event: unknown) {
  if (!event || typeof event !== 'object') {
    return null
  }

  if ('touches' in event && Array.isArray((event as { touches?: unknown[] }).touches) && (event as { touches: Touch[] }).touches.length > 0) {
    return { x: (event as { touches: Touch[] }).touches[0].clientX, y: (event as { touches: Touch[] }).touches[0].clientY }
  }

  if ('changedTouches' in event && (event as { changedTouches?: { length: number } }).changedTouches?.length) {
    const touch = (event as { changedTouches: TouchList }).changedTouches[0]
    return { x: touch.clientX, y: touch.clientY }
  }

  if ('clientX' in event && 'clientY' in event && typeof (event as { clientX: unknown }).clientX === 'number' && typeof (event as { clientY: unknown }).clientY === 'number') {
    return { x: (event as { clientX: number }).clientX, y: (event as { clientY: number }).clientY }
  }

  return null
}

/** Resolve whether one target should keep its native text-editing shortcuts. */
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

/** Resolve whether one click is extending selection instead of opening a node menu. */
function isSelectionModifierEvent(event: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
  return Boolean(event.ctrlKey || event.metaKey || event.shiftKey)
}

/** Resolve a sortable rank for one compatible port match. */
function getCompatibilityRank(compatibility: 'exact' | 'string-bridge' | 'incompatible') {
  if (compatibility === 'exact') {
    return 2
  }

  if (compatibility === 'string-bridge') {
    return 1
  }

  return 0
}

/** Index graph nodes once so canvas menus do not rescan the node list by id. */
export function buildModuleGraphNodeMap(nodes: ModuleGraphNode[]) {
  return new Map(nodes.map((node) => [node.id, node] as const))
}

/** Modules that can connect directly from one dragged port, with the port each would use. */
function getRecommendedModulesFromConnectionStart(
  modules: ModuleDefinitionRecord[],
  nodeById: ReadonlyMap<string, ModuleGraphNode>,
  connectionStart: PendingConnectionStart | null,
): RecommendedModuleMatch[] {
  if (!connectionStart) {
    return []
  }

  const existingNode = nodeById.get(connectionStart.nodeId)
  const parsedHandle = parseHandleId(connectionStart.handleId)
  if (!existingNode || !parsedHandle) {
    return []
  }

  const fromPort = connectionStart.handleType === 'source'
    ? existingNode.data.module.output_ports.find((port) => port.key === parsedHandle.portKey)
    : getActiveModuleInputPorts(existingNode.data.module, existingNode.data.inputValues).find((port) => port.key === parsedHandle.portKey)
  if (!fromPort) {
    return []
  }

  const matches = modules.flatMap((module) => {
    const candidates = connectionStart.handleType === 'source' ? getActiveModuleInputPorts(module) : module.output_ports
    let best: { compatibility: 'exact' | 'string-bridge'; portLabel: string } | null = null
    for (const port of candidates) {
      const compatibility = connectionStart.handleType === 'source'
        ? getModulePortCompatibility(fromPort.data_type, port.data_type)
        : getModulePortCompatibility(port.data_type, fromPort.data_type)
      if (compatibility === 'incompatible') continue
      if (!best || getCompatibilityRank(compatibility) > getCompatibilityRank(best.compatibility)) {
        best = { compatibility, portLabel: port.label }
      }
    }
    return best ? [{ module, compatibility: best.compatibility, portLabel: best.portLabel } satisfies RecommendedModuleMatch] : []
  })

  return matches.sort((left, right) => (
    (getCompatibilityRank(right.compatibility) - getCompatibilityRank(left.compatibility))
    || getModuleBaseDisplayName(left.module).localeCompare(getModuleBaseDisplayName(right.module), 'ko')
  ))
}

/** Build one default recommendation origin from a clicked node. */
function getDefaultConnectionStartForNode(node: ModuleGraphNode): PendingConnectionStart | null {
  const firstOutputPort = getVisibleModuleOutputPorts(node.data.module, node.data.inputValues, {
    includeAdvanced: isAdvancedOutputPortsEnabled(node.data.inputValues),
    connectedInputKeys: node.data.connectedInputKeys,
    connectedOutputKeys: node.data.connectedOutputKeys,
  })[0]
  if (firstOutputPort) {
    return { nodeId: node.id, handleId: buildHandleId('out', firstOutputPort.key), handleType: 'source' }
  }

  const firstInputPort = node.data.module.exposed_inputs[0]
  if (firstInputPort) {
    return { nodeId: node.id, handleId: buildHandleId('in', firstInputPort.key), handleType: 'target' }
  }

  return null
}

/**
 * Where a link dropped on a node body goes: the node's first free port that takes it (exact types before
 * text↔prompt), else the first occupied one. Reads the rendered handles so only visible ports are candidates.
 */
function pickBodyDropConnection({
  nodeElement,
  drag,
  nodeById,
  edges,
  isValidConnection,
}: {
  nodeElement: HTMLElement
  drag: ModuleGraphConnectionDrag
  nodeById: ReadonlyMap<string, ModuleGraphNode>
  edges: ModuleGraphEdge[]
  isValidConnection: (connection: Connection) => boolean
}) {
  const targetNodeId = nodeElement.getAttribute('data-id')
  const targetNode = targetNodeId ? nodeById.get(targetNodeId) : undefined
  if (!targetNodeId || !targetNode || targetNodeId === drag.nodeId) return null

  const wantsInput = drag.handleType === 'source'
  const handleElements = Array.from(nodeElement.querySelectorAll<HTMLElement>(`.react-flow__handle.${wantsInput ? 'target' : 'source'}`))
  let best: { handleId: string; connection: Connection; score: number } | null = null

  for (const handleElement of handleElements) {
    const handleId = handleElement.getAttribute('data-handleid')
    if (!handleId) continue
    const connection: Connection = wantsInput
      ? { source: drag.nodeId, sourceHandle: drag.handleId, target: targetNodeId, targetHandle: handleId }
      : { source: targetNodeId, sourceHandle: handleId, target: drag.nodeId, targetHandle: drag.handleId }
    if (!isValidConnection(connection)) continue
    const port = findNodePort(targetNode, wantsInput ? 'in' : 'out', parseHandleId(handleId)?.portKey)
    const compatibility = wantsInput
      ? getModulePortCompatibility(drag.dataType, port?.data_type)
      : getModulePortCompatibility(port?.data_type, drag.dataType)
    const occupied = wantsInput && !port?.multiple && edges.some((edge) => edge.target === targetNodeId && edge.targetHandle === handleId)
    const score = (occupied ? 0 : 10) + getCompatibilityRank(compatibility)
    if (!best || score > best.score) best = { handleId, connection, score }
  }

  return best
}

/** Render the React Flow canvas for the module-graph editor. */
export function ModuleGraphCanvas({
  nodes,
  edges,
  modules,
  reactFlowColorMode,
  onNodesChange,
  onEdgesChange,
  onNodeSelect,
  onEdgeSelect,
  onPaneSelect,
  onSelectionChange,
  onConnect,
  onAddModuleNode,
  onCopySelection,
  onPasteSelection,
  onDuplicateNodeById,
  onDisconnectAllNodeConnections,
  onToggleNodeDisabled,
  onRemoveNodeById,
  isValidConnection,
  fitViewKey,
  quickCreateRequest = 0,
  onOpenCustomNodeManager,
  nodeActions,
  executionLocked,
  debugMode,
  onUndo,
  onRedo,
  onAutoLayout,
}: {
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  modules: ModuleDefinitionRecord[]
  reactFlowColorMode: 'light' | 'dark' | 'system'
  onNodesChange: OnNodesChange<ModuleGraphNode>
  onEdgesChange: OnEdgesChange<ModuleGraphEdge>
  onNodeSelect: (nodeId: string) => void
  onEdgeSelect: (edgeId: string) => void
  onPaneSelect: () => void
  onSelectionChange: (selection: { nodes: ModuleGraphNode[]; edges: ModuleGraphEdge[] }) => void
  onConnect: (connection: Connection) => void
  onAddModuleNode: (module: ModuleDefinitionRecord, options?: { position?: { x: number; y: number }; connectionStart?: PendingConnectionStart }) => void
  onCopySelection: () => Promise<boolean>
  onPasteSelection: (options?: { position?: { x: number; y: number } }) => Promise<boolean>
  onDuplicateNodeById: (nodeId: string) => void
  onDisconnectAllNodeConnections: (nodeId: string) => void
  onToggleNodeDisabled: (nodeId: string) => void
  onRemoveNodeById: (nodeId: string) => void
  isValidConnection: (connection: Connection | ModuleGraphEdge) => boolean
  /** Changing it (another workflow loaded) fits the view once the new nodes are measured. */
  fitViewKey?: string | number | null
  /** Bumping it opens the node picker at the middle of the canvas (the editor bar's "+ 노드"). */
  quickCreateRequest?: number
  onOpenCustomNodeManager?: () => void
  nodeActions: ModuleGraphCanvasNodeActions
  /** A run is going: running from a node waits. */
  executionLocked: boolean
  debugMode: boolean
  onUndo: () => void
  onRedo: () => void
  onAutoLayout: () => void
}) {
  const { canExecuteGeneration } = useFeaturePermissions()
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<ModuleGraphNode, ModuleGraphEdge> | null>(null)
  const [quickCreateState, setQuickCreateState] = useState<QuickCreateState | null>(null)
  const isCoarsePointer = useIsCoarsePointer()
  const [actionMenuState, setActionMenuState] = useState<ActionMenuState | null>(null)
  const [drag, setDrag] = useState<ModuleGraphConnectionDrag | null>(null)
  const [dropTarget, setDropTarget] = useState<{ nodeId: string; handleId: string } | null>(null)
  const canvasRootRef = useRef<HTMLDivElement | null>(null)
  const suppressNextPaneClickRef = useRef(false)
  const pendingConnectionStartRef = useRef<PendingConnectionStart | null>(null)
  const connectionStartPointRef = useRef<{ x: number; y: number } | null>(null)
  const lastInteractionFlowPositionRef = useRef<{ x: number; y: number } | null>(null)
  const isCanvasActiveRef = useRef(false)
  const dragRef = useRef<ModuleGraphConnectionDrag | null>(null)
  const pickedUpEdgeRef = useRef<ModuleGraphEdge | null>(null)
  const [liftedLink, setLiftedLink] = useState<ModuleGraphLiftedLink | null>(null)
  const edgesRef = useRef(edges)
  const nodesRef = useRef(nodes)

  useEffect(() => {
    edgesRef.current = edges
    nodesRef.current = nodes
  })

  const nodeById = useMemo(() => buildModuleGraphNodeMap(nodes), [nodes])
  const nodesInitialized = useNodesInitialized()
  const [fittedKey, setFittedKey] = useState<string | number | null | undefined>(undefined)

  useEffect(() => {
    if (!reactFlowInstance || !nodesInitialized || fittedKey === fitViewKey) {
      return
    }
    setFittedKey(fitViewKey)
    void reactFlowInstance.fitView(GRAPH_FIT_VIEW_OPTIONS)
  }, [fitViewKey, fittedKey, nodesInitialized, reactFlowInstance])

  const recommendedModules = useMemo(
    () => getRecommendedModulesFromConnectionStart(modules, nodeById, quickCreateState?.connectionStart ?? null),
    [modules, nodeById, quickCreateState?.connectionStart],
  )

  const reactFlowNodes = useMemo(
    () => (isCoarsePointer ? nodes.map((node) => ({ ...node, dragHandle: MOBILE_NODE_DRAG_HANDLE_SELECTOR })) : nodes),
    [isCoarsePointer, nodes],
  )

  // Links saved before the module edge existed get its look as well; links into a running node flow.
  const runningNodeSignature = nodes.filter((node) => node.data.executionStatus === 'running').map((node) => node.id).join('\u0000')
  const reactFlowEdges = useMemo(() => {
    const runningNodeIds = new Set(runningNodeSignature ? runningNodeSignature.split('\u0000') : [])
    return edges.map((edge) => {
      const animated = runningNodeIds.has(edge.target)
      return edge.type === 'module' && !edge.markerEnd && Boolean(edge.animated) === animated
        ? edge
        : { ...edge, type: 'module', markerEnd: undefined, animated }
    })
  }, [edges, runningNodeSignature])

  // "← source" labels for linked inputs; only recomputed when links or node names change, not on every move.
  const labelSignature = nodes.map((node) => `${node.id}\u0001${getModuleNodeDisplayLabel(node)}`).join('\u0002')
  const inputSources = useMemo(() => {
    const labelById = new Map(labelSignature.split('\u0002').filter(Boolean).map((entry) => entry.split('\u0001') as [string, string]))
    const sources = new Map<string, string>()
    for (const edge of edges) {
      const portKey = parseHandleId(edge.targetHandle)?.portKey
      if (!portKey) continue
      const label = labelById.get(edge.source)
      if (label !== undefined) sources.set(buildInputSourceKey(edge.target, portKey), label)
    }
    return sources
  }, [edges, labelSignature])

  const closeQuickCreateMenu = useCallback(() => {
    setQuickCreateState(null)
  }, [])

  const closeActionMenu = useCallback(() => {
    setActionMenuState(null)
  }, [])

  const suppressNextPaneClick = useCallback(() => {
    suppressNextPaneClickRef.current = true
    window.setTimeout(() => {
      suppressNextPaneClickRef.current = false
    }, 0)
  }, [])

  const openQuickCreateMenuAt = useCallback((
    anchor: { x: number; y: number },
    flowPosition: { x: number; y: number },
    mode: 'pane' | 'connect',
    connectionStart: PendingConnectionStart | null,
    align: QuickCreateState['align'] = 'start',
  ) => {
    suppressNextPaneClick()
    // Raw pointer point: the Radix popover flips/shifts against the viewport using the menu's real size.
    setQuickCreateState({ mode, anchor, align, flowPosition, connectionStart })
  }, [suppressNextPaneClick])

  const openQuickCreateMenu = useCallback((
    event: unknown,
    mode: 'pane' | 'connect',
    connectionStart: PendingConnectionStart | null,
  ) => {
    const clientPoint = getEventClientPoint(event)
    if (!clientPoint || !reactFlowInstance) {
      return
    }

    const flowPosition = reactFlowInstance.screenToFlowPosition({ x: clientPoint.x, y: clientPoint.y })
    openQuickCreateMenuAt(clientPoint, flowPosition, mode, connectionStart)
  }, [openQuickCreateMenuAt, reactFlowInstance])

  const openPaneActionMenu = useCallback((event: unknown) => {
    const clientPoint = getEventClientPoint(event)
    if (!clientPoint || !reactFlowInstance) {
      return
    }

    const flowPosition = reactFlowInstance.screenToFlowPosition({ x: clientPoint.x, y: clientPoint.y })
    suppressNextPaneClick()
    setActionMenuState({ kind: 'pane', anchor: clientPoint, flowPosition })
  }, [reactFlowInstance, suppressNextPaneClick])

  const openNodeActionMenuAt = useCallback((nodeId: string, anchor: { x: number; y: number }) => {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId)
    if (!node || !reactFlowInstance) {
      return
    }

    suppressNextPaneClick()
    setQuickCreateState(null)
    setActionMenuState({
      kind: 'node',
      anchor,
      flowPosition: reactFlowInstance.screenToFlowPosition(anchor),
      nodeId,
      nodeName: getModuleNodeDisplayLabel(node),
      hasAdvancedOutputPorts: hasAdvancedModuleOutputPorts(node.data.module, node.data.inputValues),
      advancedOutputPortsEnabled: isAdvancedOutputPortsEnabled(node.data.inputValues),
      disabled: node.data.disabled === true,
    })
  }, [reactFlowInstance, suppressNextPaneClick])

  // Node cards get one stable actions object; it always calls the latest handlers.
  const nodeActionsRef = useRef(nodeActions)
  const openNodeActionMenuAtRef = useRef(openNodeActionMenuAt)
  const graphActionsRef = useRef({ onDuplicateNodeById, onToggleNodeDisabled, onRemoveNodeById, onNodesChange })
  useEffect(() => {
    nodeActionsRef.current = nodeActions
    openNodeActionMenuAtRef.current = openNodeActionMenuAt
    graphActionsRef.current = { onDuplicateNodeById, onToggleNodeDisabled, onRemoveNodeById, onNodesChange }
  })
  const stableNodeActions = useMemo<ModuleGraphNodeActions>(() => ({
    changeValue: (nodeId, key, value) => nodeActionsRef.current.changeValue(nodeId, key, value),
    clearValue: (nodeId, key) => nodeActionsRef.current.clearValue(nodeId, key),
    changeLabel: (nodeId, label) => nodeActionsRef.current.changeLabel(nodeId, label),
    changeImage: (nodeId, key, image) => nodeActionsRef.current.changeImage(nodeId, key, image),
    execute: (nodeId, force) => nodeActionsRef.current.execute(nodeId, force),
    editInPanel: (nodeId, key) => {
      // Clicks inside a card's controls do not select the node; editing in the panel does.
      graphActionsRef.current.onNodesChange(nodesRef.current.map((node) => ({ type: 'select', id: node.id, selected: node.id === nodeId })))
      nodeActionsRef.current.editInPanel(nodeId, key)
    },
    duplicate: (nodeId) => graphActionsRef.current.onDuplicateNodeById(nodeId),
    toggleDisabled: (nodeId) => graphActionsRef.current.onToggleNodeDisabled(nodeId),
    remove: (nodeId) => graphActionsRef.current.onRemoveNodeById(nodeId),
    openMenu: (nodeId, anchor) => openNodeActionMenuAtRef.current(nodeId, anchor),
  }), [])

  /** Lift the link out of one input: remove it and keep dragging it from its source port. */
  const pickUpInput = useCallback((nodeId: string, handleId: string, point: { x: number; y: number }) => {
    const edge = edgesRef.current.find((candidate) => candidate.target === nodeId && candidate.targetHandle === handleId)
    const root = canvasRootRef.current
    if (!edge || !root || !edge.sourceHandle) return
    const sourceHandleElement = root.querySelector<HTMLElement>(
      `.react-flow__handle.source[data-nodeid="${CSS.escape(edge.source)}"][data-handleid="${CSS.escape(edge.sourceHandle)}"]`,
    )
    if (!sourceHandleElement) return
    const sourcePortKey = parseHandleId(edge.sourceHandle)?.portKey
    const targetPortKey = parseHandleId(handleId)?.portKey
    const sourceNode = nodesRef.current.find((candidate) => candidate.id === edge.source)
    pickedUpEdgeRef.current = edge
    if (sourcePortKey && targetPortKey) {
      setLiftedLink({
        sourceNodeId: edge.source,
        sourcePortKey,
        targetNodeId: nodeId,
        targetPortKey,
        sourceLabel: sourceNode ? getModuleNodeDisplayLabel(sourceNode) : '',
      })
    }
    onEdgesChange([{ type: 'remove', id: edge.id }])
    // React Flow starts a link from a mousedown on a handle; the held button carries the drag on from here.
    sourceHandleElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0, buttons: 1, view: window }))
  }, [onEdgesChange])

  const canvasContextValue = useMemo<ModuleGraphCanvasContextValue>(() => ({
    drag,
    dropTarget,
    pickUpInput,
    canPickUp: !isCoarsePointer,
    debugMode,
    inputSources,
    liftedLink,
  }), [debugMode, drag, dropTarget, inputSources, isCoarsePointer, liftedLink, pickUpInput])

  // "+ 노드" from the editor bar: open the picker at the middle of the visible canvas.
  const handledQuickCreateRequestRef = useRef(quickCreateRequest)
  useEffect(() => {
    if (quickCreateRequest === handledQuickCreateRequestRef.current) {
      return
    }
    handledQuickCreateRequestRef.current = quickCreateRequest
    const rect = canvasRootRef.current?.getBoundingClientRect()
    if (!rect || !reactFlowInstance) {
      return
    }
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 }
    const flowPosition = reactFlowInstance.screenToFlowPosition(center)
    closeActionMenu()
    openQuickCreateMenuAt(center, flowPosition, 'pane', null, 'center')
  }, [closeActionMenu, openQuickCreateMenuAt, quickCreateRequest, reactFlowInstance])

  const rememberInteractionPoint = useCallback((event: unknown) => {
    const clientPoint = getEventClientPoint(event)
    if (!clientPoint || !reactFlowInstance) {
      return
    }

    lastInteractionFlowPositionRef.current = reactFlowInstance.screenToFlowPosition({ x: clientPoint.x, y: clientPoint.y })
  }, [reactFlowInstance])

  const getPasteFlowPosition = useCallback(() => {
    if (lastInteractionFlowPositionRef.current) {
      return lastInteractionFlowPositionRef.current
    }

    if (!reactFlowInstance || !canvasRootRef.current) {
      return null
    }

    const rect = canvasRootRef.current.getBoundingClientRect()
    return reactFlowInstance.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }, [reactFlowInstance])

  const selectAll = useCallback(() => {
    onNodesChange(nodesRef.current.map((node) => ({ type: 'select', id: node.id, selected: true })))
  }, [onNodesChange])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const canvasRoot = canvasRootRef.current
      if (!canvasRoot) {
        return
      }

      isCanvasActiveRef.current = canvasRoot.contains(event.target as Node)
      if (isCanvasActiveRef.current) {
        rememberInteractionPoint(event)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isCanvasActiveRef.current || isEditableTarget(event.target)) {
        return
      }

      if (!(event.ctrlKey || event.metaKey)) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'z' || key === 'y') {
        event.preventDefault()
        closeQuickCreateMenu()
        closeActionMenu()
        if (key === 'y' || event.shiftKey) onRedo()
        else onUndo()
        return
      }

      if (key === 'd') {
        event.preventDefault()
        for (const node of nodesRef.current.filter((candidate) => candidate.selected)) {
          onDuplicateNodeById(node.id)
        }
        return
      }

      if (key === 'a') {
        event.preventDefault()
        selectAll()
        return
      }

      if (key === 'c') {
        event.preventDefault()
        closeQuickCreateMenu()
        closeActionMenu()
        void onCopySelection()
        return
      }

      if (key === 'v') {
        event.preventDefault()
        closeQuickCreateMenu()
        closeActionMenu()
        const pastePosition = getPasteFlowPosition()
        void onPasteSelection(pastePosition ? { position: pastePosition } : undefined)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeActionMenu, closeQuickCreateMenu, getPasteFlowPosition, onCopySelection, onDuplicateNodeById, onPasteSelection, onRedo, onUndo, rememberInteractionPoint, selectAll])

  const handleConnectStart = useCallback<OnConnectStart>((event, params) => {
    rememberInteractionPoint(event)
    if (!params.nodeId || !params.handleId || (params.handleType !== 'source' && params.handleType !== 'target')) {
      return
    }
    pendingConnectionStartRef.current = { nodeId: params.nodeId, handleId: params.handleId, handleType: params.handleType }
    const clientPoint = getEventClientPoint(event)
    connectionStartPointRef.current = clientPoint ? { x: clientPoint.x, y: clientPoint.y } : null
    const port = findNodePort(nodeById.get(params.nodeId), params.handleType === 'source' ? 'out' : 'in', parseHandleId(params.handleId)?.portKey)
    const nextDrag: ModuleGraphConnectionDrag = { nodeId: params.nodeId, handleId: params.handleId, handleType: params.handleType, dataType: port?.data_type ?? null }
    dragRef.current = nextDrag
    setDrag(nextDrag)
    setDropTarget(null)
    closeActionMenu()
    closeQuickCreateMenu()
  }, [closeActionMenu, closeQuickCreateMenu, nodeById, rememberInteractionPoint])

  const handleConnectEnd = useCallback<OnConnectEnd>((event, connectionState) => {
    rememberInteractionPoint(event)
    const currentDrag = dragRef.current
    const pendingConnectionStart = pendingConnectionStartRef.current
    const pickedUp = pickedUpEdgeRef.current
    const clientPoint = getEventClientPoint(event)
    const startPoint = connectionStartPointRef.current
    dragRef.current = null
    pickedUpEdgeRef.current = null
    connectionStartPointRef.current = null
    pendingConnectionStartRef.current = null
    setDrag(null)
    setDropTarget(null)
    setLiftedLink(null)

    // Dropped on (or snapped to) a port: React Flow already connected it.
    if (connectionState?.toHandle && connectionState.isValid) {
      return
    }

    if (currentDrag && clientPoint) {
      const nodeElement = document.elementFromPoint(clientPoint.x, clientPoint.y)?.closest<HTMLElement>('.react-flow__node')
      if (nodeElement) {
        const best = pickBodyDropConnection({ nodeElement, drag: currentDrag, nodeById, edges: edgesRef.current, isValidConnection })
        if (best) {
          onConnect(best.connection)
        }
        // A node with no port for this link takes nothing; a lifted link stays removed.
        return
      }
    }

    // A lifted link dropped on empty canvas is simply unplugged.
    if (pickedUp) {
      return
    }

    const dragDistance = clientPoint && startPoint ? Math.hypot(clientPoint.x - startPoint.x, clientPoint.y - startPoint.y) : 0
    if (pendingConnectionStart && dragDistance >= 6) {
      suppressNextPaneClick()
      closeActionMenu()
      openQuickCreateMenu(event, 'connect', pendingConnectionStart)
    }
  }, [closeActionMenu, isValidConnection, nodeById, onConnect, openQuickCreateMenu, rememberInteractionPoint, suppressNextPaneClick])

  const updateDropTarget = useCallback((nodeId: string | null) => {
    const currentDrag = dragRef.current
    if (!currentDrag || !nodeId) {
      setDropTarget(null)
      return
    }
    const nodeElement = canvasRootRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
    const best = nodeElement ? pickBodyDropConnection({ nodeElement, drag: currentDrag, nodeById, edges: edgesRef.current, isValidConnection }) : null
    setDropTarget(best ? { nodeId, handleId: best.handleId } : null)
  }, [isValidConnection, nodeById])

  const connectionLineStyle = useMemo(() => ({
    stroke: drag?.dataType ? getPortTypeColor(drag.dataType) : 'var(--muted-foreground)',
    strokeWidth: 2.5,
  }), [drag?.dataType])

  return (
    <ModuleGraphNodeActionsContext.Provider value={stableNodeActions}>
      <ModuleGraphExecutionLockContext.Provider value={executionLocked}>
        <ModuleGraphCanvasContext.Provider value={canvasContextValue}>
          <div
            ref={canvasRootRef}
            className="relative h-full min-h-[20rem] overflow-hidden bg-surface-lowest"
            onDoubleClick={(event) => {
              const target = event.target as HTMLElement
              if (!target.closest('.react-flow__pane') || target.closest('.react-flow__node, .react-flow__edge')) return
              closeActionMenu()
              openQuickCreateMenu(event, 'pane', null)
            }}
          >
            <ReactFlow
              className={isCoarsePointer ? 'theme-graph-flow touch-scroll-safe' : 'theme-graph-flow'}
              nodes={reactFlowNodes}
              edges={reactFlowEdges}
              onInit={setReactFlowInstance}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onSelectionChange={onSelectionChange}
              onNodeClick={(event, node) => {
                rememberInteractionPoint(event)
                closeQuickCreateMenu()
                closeActionMenu()
                if (!isSelectionModifierEvent(event)) {
                  onNodeSelect(node.id)
                }
              }}
              onNodeContextMenu={(event, node) => {
                event.preventDefault()
                rememberInteractionPoint(event)
                closeQuickCreateMenu()
                onNodeSelect(node.id)
                openNodeActionMenuAt(node.id, { x: event.clientX, y: event.clientY })
              }}
              onNodeMouseEnter={(_, node) => {
                if (dragRef.current) updateDropTarget(node.id)
              }}
              onNodeMouseLeave={() => {
                if (dragRef.current) updateDropTarget(null)
              }}
              onEdgeClick={(event, edge) => {
                rememberInteractionPoint(event)
                closeQuickCreateMenu()
                closeActionMenu()
                onEdgeSelect(edge.id)
              }}
              onPaneClick={(event) => {
                rememberInteractionPoint(event)
                if (suppressNextPaneClickRef.current) {
                  suppressNextPaneClickRef.current = false
                  return
                }

                closeQuickCreateMenu()
                closeActionMenu()
                onPaneSelect()
              }}
              onPaneContextMenu={(event) => {
                event.preventDefault()
                rememberInteractionPoint(event)
                closeQuickCreateMenu()
                onPaneSelect()
                openPaneActionMenu(event)
              }}
              onConnectStart={handleConnectStart}
              onConnectEnd={handleConnectEnd}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              nodeTypes={MODULE_GRAPH_NODE_TYPES}
              edgeTypes={MODULE_GRAPH_EDGE_TYPES}
              defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
              connectionLineStyle={connectionLineStyle}
              defaultViewport={INITIAL_GRAPH_VIEWPORT}
              colorMode={reactFlowColorMode}
              proOptions={PRO_OPTIONS}
              nodesDraggable
              elementsSelectable
              zoomOnDoubleClick={false}
              minZoom={GRAPH_MIN_ZOOM}
              selectionKeyCode={isCoarsePointer ? null : ['Meta', 'Control']}
              selectionOnDrag={false}
              multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
              panOnDrag
              snapToGrid
              connectionRadius={32}
              deleteKeyCode={['Backspace', 'Delete']}
            >
              <MiniMap
                pannable
                zoomable
                nodeColor="var(--primary)"
                maskColor="color-mix(in srgb, var(--background) 72%, transparent)"
                className="!bg-surface-lowest max-sm:!hidden"
                style={{ width: 140, height: 90 }}
              />
              <Controls showInteractive={false} />
              <Background gap={20} size={1} color="color-mix(in srgb, var(--foreground) 10%, transparent)" />
            </ReactFlow>

            {actionMenuState ? (
              <ModuleGraphActionMenu
                state={actionMenuState}
                canRun={canExecuteGeneration && !executionLocked}
                onRunNode={() => {
                  const nodeId = actionMenuState.nodeId
                  closeActionMenu()
                  if (nodeId) stableNodeActions.execute(nodeId, false)
                }}
                onRerunNode={() => {
                  const nodeId = actionMenuState.nodeId
                  closeActionMenu()
                  if (nodeId) stableNodeActions.execute(nodeId, true)
                }}
                onOpenNodePicker={() => {
                  const currentState = actionMenuState
                  closeActionMenu()
                  openQuickCreateMenuAt(currentState.anchor, currentState.flowPosition, 'pane', null)
                }}
                onPaste={() => {
                  const position = actionMenuState.flowPosition
                  closeActionMenu()
                  void onPasteSelection({ position })
                }}
                onAutoLayout={() => {
                  closeActionMenu()
                  onAutoLayout()
                }}
                onSelectAll={() => {
                  closeActionMenu()
                  selectAll()
                }}
                onDuplicateNode={() => {
                  const nodeId = actionMenuState.nodeId
                  closeActionMenu()
                  if (nodeId) onDuplicateNodeById(nodeId)
                }}
                onDisconnectAllConnections={() => {
                  const nodeId = actionMenuState.nodeId
                  closeActionMenu()
                  if (nodeId) onDisconnectAllNodeConnections(nodeId)
                }}
                onToggleNodeDisabled={() => {
                  const nodeId = actionMenuState.nodeId
                  closeActionMenu()
                  if (nodeId) onToggleNodeDisabled(nodeId)
                }}
                onRemoveNode={() => {
                  const nodeId = actionMenuState.nodeId
                  closeActionMenu()
                  if (nodeId) onRemoveNodeById(nodeId)
                }}
                onShowRecommendedNodes={() => {
                  if (actionMenuState.kind !== 'node' || !actionMenuState.nodeId) {
                    return
                  }

                  const targetNode = nodeById.get(actionMenuState.nodeId)
                  const connectionStart = targetNode ? getDefaultConnectionStartForNode(targetNode) : null
                  const flowPosition = targetNode
                    ? { x: targetNode.position.x + (targetNode.measured?.width ?? 260) + 80, y: targetNode.position.y }
                    : actionMenuState.flowPosition
                  closeActionMenu()
                  openQuickCreateMenuAt(actionMenuState.anchor, flowPosition, connectionStart ? 'connect' : 'pane', connectionStart)
                }}
                onToggleAdvancedOutputs={() => {
                  const nodeId = actionMenuState.nodeId
                  closeActionMenu()
                  const targetNode = nodeId ? nodeById.get(nodeId) : undefined
                  if (nodeId && targetNode) {
                    stableNodeActions.changeValue(nodeId, ADVANCED_OUTPUT_PORTS_ENABLED_KEY, !isAdvancedOutputPortsEnabled(targetNode.data.inputValues))
                  }
                }}
                onClose={closeActionMenu}
              />
            ) : null}

            {quickCreateState ? (
              <ModuleGraphQuickCreateMenu
                key={`${quickCreateState.mode}:${quickCreateState.anchor.x}:${quickCreateState.anchor.y}`}
                mode={quickCreateState.mode}
                anchor={quickCreateState.anchor}
                align={quickCreateState.align}
                modules={modules}
                recommendedModules={recommendedModules}
                onSelectModule={(module) => {
                  onAddModuleNode(module, {
                    position: quickCreateState.flowPosition,
                    connectionStart: quickCreateState.connectionStart ?? undefined,
                  })
                  closeQuickCreateMenu()
                }}
                onOpenCustomNodeManager={onOpenCustomNodeManager ? () => {
                  closeQuickCreateMenu()
                  onOpenCustomNodeManager()
                } : undefined}
                onClose={closeQuickCreateMenu}
              />
            ) : null}
          </div>
        </ModuleGraphCanvasContext.Provider>
      </ModuleGraphExecutionLockContext.Provider>
    </ModuleGraphNodeActionsContext.Provider>
  )
}
