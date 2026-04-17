import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Connection, type OnEdgesChange, type OnNodesChange, type ReactFlowInstance } from '@xyflow/react'
import type { ModuleDefinitionRecord } from '@/lib/api'
import { useIsCoarsePointer } from '@/lib/use-is-coarse-pointer'
import { ModuleGraphActionMenu, type ModuleGraphActionMenuState } from './module-graph-action-menu'
import { ModuleGraphQuickCreateMenu } from './module-graph-quick-create-menu'
import { ModuleGraphNodeCard } from './module-graph-node-card'
import { buildHandleId, getModuleBaseDisplayName, getModuleNodeDisplayLabel, getModulePortCompatibility, parseHandleId, type ModuleGraphEdge, type ModuleGraphNode } from '../module-graph-shared'

const MODULE_GRAPH_NODE_TYPES = { module: ModuleGraphNodeCard }
const MOBILE_NODE_DRAG_HANDLE_SELECTOR = '.module-graph-drag-handle'
const INITIAL_GRAPH_VIEWPORT = { x: 0, y: 0, zoom: 0.65 }
const INITIAL_GRAPH_FIT_VIEW_OPTIONS = { padding: 0.35, maxZoom: 0.65 }

type PendingConnectionStart = {
  nodeId: string
  handleId: string
  handleType: 'source' | 'target'
}

export type RecommendedModuleMatch = {
  module: ModuleDefinitionRecord
  compatibility: 'exact' | 'string-bridge'
}

type QuickCreateState = {
  mode: 'pane' | 'connect'
  anchor: { x: number; y: number }
  flowPosition: { x: number; y: number }
  connectionStart: PendingConnectionStart | null
}

type ActionMenuState = (ModuleGraphActionMenuState & { flowPosition: { x: number; y: number }; nodeId?: string })

/** Resolve one mouse/touch client point from graph-canvas interactions. */
function getEventClientPoint(event: unknown) {
  if (!event || typeof event !== 'object') {
    return null
  }

  if ('touches' in event && Array.isArray((event as { touches?: unknown[] }).touches) && (event as { touches: Touch[] }).touches.length > 0) {
    return { x: (event as { touches: Touch[] }).touches[0].clientX, y: (event as { touches: Touch[] }).touches[0].clientY }
  }

  if ('changedTouches' in event && Array.isArray((event as { changedTouches?: unknown[] }).changedTouches) && (event as { changedTouches: Touch[] }).changedTouches.length > 0) {
    return { x: (event as { changedTouches: Touch[] }).changedTouches[0].clientX, y: (event as { changedTouches: Touch[] }).changedTouches[0].clientY }
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

/** Build the recommended modules that can connect directly from one pending dragged port. */
function getRecommendedModulesFromConnectionStart(
  modules: ModuleDefinitionRecord[],
  nodes: ModuleGraphNode[],
  connectionStart: PendingConnectionStart | null,
): RecommendedModuleMatch[] {
  if (!connectionStart) {
    return []
  }

  const existingNode = nodes.find((node) => node.id === connectionStart.nodeId)
  const parsedHandle = parseHandleId(connectionStart.handleId)
  if (!existingNode || !parsedHandle) {
    return []
  }

  const matches = connectionStart.handleType === 'source'
    ? (() => {
        const sourcePort = existingNode.data.module.output_ports.find((port) => port.key === parsedHandle.portKey)
        if (!sourcePort) {
          return []
        }

        return modules.flatMap((module) => {
          const bestCompatibility = module.exposed_inputs.reduce<'exact' | 'string-bridge' | 'incompatible'>((best, port) => {
            const compatibility = getModulePortCompatibility(sourcePort.data_type, port.data_type)
            return getCompatibilityRank(compatibility) > getCompatibilityRank(best) ? compatibility : best
          }, 'incompatible')

          return bestCompatibility === 'incompatible'
            ? []
            : [{ module, compatibility: bestCompatibility } satisfies RecommendedModuleMatch]
        })
      })()
    : (() => {
        const targetPort = existingNode.data.module.exposed_inputs.find((port) => port.key === parsedHandle.portKey)
        if (!targetPort) {
          return []
        }

        return modules.flatMap((module) => {
          const bestCompatibility = module.output_ports.reduce<'exact' | 'string-bridge' | 'incompatible'>((best, port) => {
            const compatibility = getModulePortCompatibility(port.data_type, targetPort.data_type)
            return getCompatibilityRank(compatibility) > getCompatibilityRank(best) ? compatibility : best
          }, 'incompatible')

          return bestCompatibility === 'incompatible'
            ? []
            : [{ module, compatibility: bestCompatibility } satisfies RecommendedModuleMatch]
        })
      })()

  return [...matches].sort((left, right) => {
    const compatibilityDelta = getCompatibilityRank(right.compatibility) - getCompatibilityRank(left.compatibility)
    if (compatibilityDelta !== 0) {
      return compatibilityDelta
    }

    return getModuleBaseDisplayName(left.module).localeCompare(getModuleBaseDisplayName(right.module), 'ko')
  })
}

/** Build one default recommendation origin from a clicked node. */
function getDefaultConnectionStartForNode(node: ModuleGraphNode): PendingConnectionStart | null {
  const firstOutputPort = node.data.module.output_ports[0]
  if (firstOutputPort) {
    return {
      nodeId: node.id,
      handleId: buildHandleId('out', firstOutputPort.key),
      handleType: 'source',
    }
  }

  const firstInputPort = node.data.module.exposed_inputs[0]
  if (firstInputPort) {
    return {
      nodeId: node.id,
      handleId: buildHandleId('in', firstInputPort.key),
      handleType: 'target',
    }
  }

  return null
}

/** Resolve one centered anchor above the clicked node so the quick menu never covers the node body. */
function getNodeQuickMenuAnchor(event: unknown) {
  if (!event || typeof event !== 'object' || !('target' in event)) {
    return null
  }

  const eventTarget = (event as { target?: EventTarget | null }).target
  if (!(eventTarget instanceof Element)) {
    return null
  }

  const nodeElement = eventTarget.closest('.react-flow__node') as HTMLElement | null
  if (!nodeElement) {
    return null
  }

  const rect = nodeElement.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: Math.max(rect.top - 10, 12),
  }
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
  onRemoveNodeById,
  isValidConnection,
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
  onRemoveNodeById: (nodeId: string) => void
  isValidConnection: (connection: Connection | ModuleGraphEdge) => boolean
}) {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<ModuleGraphNode, ModuleGraphEdge> | null>(null)
  const [quickCreateState, setQuickCreateState] = useState<QuickCreateState | null>(null)
  const isCoarsePointer = useIsCoarsePointer()
  const [actionMenuState, setActionMenuState] = useState<ActionMenuState | null>(null)
  const canvasRootRef = useRef<HTMLDivElement | null>(null)
  const suppressNextPaneClickRef = useRef(false)
  const pendingConnectionStartRef = useRef<PendingConnectionStart | null>(null)
  const connectionStartPointRef = useRef<{ x: number; y: number } | null>(null)
  const lastInteractionFlowPositionRef = useRef<{ x: number; y: number } | null>(null)
  const isCanvasActiveRef = useRef(false)

  const recommendedModules = useMemo(
    () => getRecommendedModulesFromConnectionStart(modules, nodes, quickCreateState?.connectionStart ?? null),
    [modules, nodes, quickCreateState?.connectionStart],
  )

  const reactFlowNodes = useMemo(
    () => nodes.map((node) => ({
      ...node,
      dragHandle: isCoarsePointer ? MOBILE_NODE_DRAG_HANDLE_SELECTOR : undefined,
    })),
    [isCoarsePointer, nodes],
  )

  const closeQuickCreateMenu = useCallback(() => {
    setQuickCreateState(null)
  }, [])

  const closeActionMenu = useCallback(() => {
    setActionMenuState(null)
  }, [])

  const openQuickCreateMenuAt = useCallback((
    anchor: { x: number; y: number },
    flowPosition: { x: number; y: number },
    mode: 'pane' | 'connect',
    connectionStart: PendingConnectionStart | null,
  ) => {
    const menuWidth = 360
    const menuHeight = 560
    const viewportPadding = 12

    setQuickCreateState({
      mode,
      anchor: {
        x: Math.min(Math.max(anchor.x, viewportPadding), Math.max(window.innerWidth - menuWidth - viewportPadding, viewportPadding)),
        y: Math.min(Math.max(anchor.y, viewportPadding), Math.max(window.innerHeight - menuHeight - viewportPadding, viewportPadding)),
      },
      flowPosition,
      connectionStart,
    })
  }, [])

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
    setActionMenuState({
      kind: 'pane',
      anchor: clientPoint,
      flowPosition,
    })
  }, [reactFlowInstance])

  const openNodeActionMenu = useCallback((event: unknown, node: ModuleGraphNode) => {
    const anchor = getNodeQuickMenuAnchor(event)
    if (!anchor || !reactFlowInstance) {
      return
    }

    const flowPosition = reactFlowInstance.screenToFlowPosition({ x: anchor.x, y: anchor.y })
    setActionMenuState({
      kind: 'node',
      anchor,
      flowPosition,
      nodeId: node.id,
      nodeName: getModuleNodeDisplayLabel(node),
    })
  }, [reactFlowInstance])

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
    return reactFlowInstance.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
  }, [reactFlowInstance])

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
  }, [closeActionMenu, closeQuickCreateMenu, getPasteFlowPosition, onCopySelection, onPasteSelection, rememberInteractionPoint])

  return (
    <div ref={canvasRootRef} className="relative h-[760px] overflow-hidden rounded-sm border border-border bg-surface-lowest">
      <ReactFlow
        className={isCoarsePointer ? 'theme-graph-flow touch-scroll-safe' : 'theme-graph-flow'}
        nodes={reactFlowNodes}
        edges={edges}
        onInit={setReactFlowInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onNodeClick={(event, node) => {
          rememberInteractionPoint(event)
          closeQuickCreateMenu()
          onNodeSelect(node.id)
          if (isSelectionModifierEvent(event)) {
            closeActionMenu()
            return
          }

          openNodeActionMenu(event, node)
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault()
          rememberInteractionPoint(event)
          closeQuickCreateMenu()
          onNodeSelect(node.id)
          openNodeActionMenu(event, node)
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
        onConnectStart={(event, params) => {
          rememberInteractionPoint(event)
          if (params.nodeId && params.handleId && (params.handleType === 'source' || params.handleType === 'target')) {
            pendingConnectionStartRef.current = {
              nodeId: params.nodeId,
              handleId: params.handleId,
              handleType: params.handleType,
            }
            const clientPoint = getEventClientPoint(event)
            connectionStartPointRef.current = clientPoint ? { x: clientPoint.x, y: clientPoint.y } : null
          }
        }}
        onConnectEnd={(event, connectionState) => {
          rememberInteractionPoint(event)
          const pendingConnectionStart = pendingConnectionStartRef.current
          const clientPoint = getEventClientPoint(event)
          const startPoint = connectionStartPointRef.current
          const dragDistance = clientPoint && startPoint ? Math.hypot(clientPoint.x - startPoint.x, clientPoint.y - startPoint.y) : 0
          const droppedOnExistingTarget = Boolean((connectionState as { toNode?: unknown } | null | undefined)?.toNode)

          if (pendingConnectionStart && !droppedOnExistingTarget && dragDistance >= 6) {
            suppressNextPaneClickRef.current = true
            window.setTimeout(() => {
              suppressNextPaneClickRef.current = false
            }, 0)
            closeActionMenu()
            openQuickCreateMenu(event, 'connect', pendingConnectionStart)
          }

          connectionStartPointRef.current = null
          pendingConnectionStartRef.current = null
        }}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        nodeTypes={MODULE_GRAPH_NODE_TYPES}
        fitView
        fitViewOptions={INITIAL_GRAPH_FIT_VIEW_OPTIONS}
        defaultViewport={INITIAL_GRAPH_VIEWPORT}
        colorMode={reactFlowColorMode}
        nodesDraggable
        elementsSelectable
        selectionOnDrag={!isCoarsePointer}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        panOnDrag={isCoarsePointer}
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

      {actionMenuState ? (
        <ModuleGraphActionMenu
          state={actionMenuState}
          onOpenNodePicker={() => {
            const currentState = actionMenuState
            closeActionMenu()
            openQuickCreateMenuAt(currentState.anchor, currentState.flowPosition, 'pane', null)
          }}
          onDuplicateNode={() => {
            if (actionMenuState.kind !== 'node' || !actionMenuState.nodeId) {
              return
            }

            closeActionMenu()
            onDuplicateNodeById(actionMenuState.nodeId)
          }}
          onDisconnectAllConnections={() => {
            if (actionMenuState.kind !== 'node' || !actionMenuState.nodeId) {
              return
            }

            closeActionMenu()
            onDisconnectAllNodeConnections(actionMenuState.nodeId)
          }}
          onRemoveNode={() => {
            if (actionMenuState.kind !== 'node' || !actionMenuState.nodeId) {
              return
            }

            closeActionMenu()
            onRemoveNodeById(actionMenuState.nodeId)
          }}
          onShowRecommendedNodes={() => {
            if (actionMenuState.kind !== 'node' || !actionMenuState.nodeId) {
              return
            }

            const targetNode = nodes.find((node) => node.id === actionMenuState.nodeId)
            const connectionStart = targetNode ? getDefaultConnectionStartForNode(targetNode) : null
            closeActionMenu()
            openQuickCreateMenuAt(actionMenuState.anchor, actionMenuState.flowPosition, connectionStart ? 'connect' : 'pane', connectionStart)
          }}
        />
      ) : null}

      {quickCreateState ? (
        <ModuleGraphQuickCreateMenu
          key={`${quickCreateState.mode}:${quickCreateState.anchor.x}:${quickCreateState.anchor.y}`}
          mode={quickCreateState.mode}
          anchor={quickCreateState.anchor}
          modules={modules}
          recommendedModules={recommendedModules}
          onSelectModule={(module) => {
            onAddModuleNode(module, {
              position: quickCreateState.flowPosition,
              connectionStart: quickCreateState.connectionStart ?? undefined,
            })
            closeQuickCreateMenu()
          }}
          onClose={closeQuickCreateMenu}
        />
      ) : null}
    </div>
  )
}
