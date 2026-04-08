import { useCallback, useMemo, useRef, useState } from 'react'
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Connection, type OnEdgesChange, type OnNodesChange, type ReactFlowInstance } from '@xyflow/react'
import type { ModuleDefinitionRecord } from '@/lib/api'
import { ModuleGraphActionMenu, type ModuleGraphActionMenuState } from './module-graph-action-menu'
import { ModuleGraphQuickCreateMenu } from './module-graph-quick-create-menu'
import { ModuleGraphNodeCard } from './module-graph-node-card'
import { buildHandleId, getModulePortCompatibility, parseHandleId, type ModuleGraphEdge, type ModuleGraphNode } from '../module-graph-shared'

const MODULE_GRAPH_NODE_TYPES = { module: ModuleGraphNodeCard }

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

    return left.module.name.localeCompare(right.module.name, 'ko')
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
  onConnect,
  onAddModuleNode,
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
  onConnect: (connection: Connection) => void
  onAddModuleNode: (module: ModuleDefinitionRecord, options?: { position?: { x: number; y: number }; connectionStart?: PendingConnectionStart }) => void
  onDuplicateNodeById: (nodeId: string) => void
  onDisconnectAllNodeConnections: (nodeId: string) => void
  onRemoveNodeById: (nodeId: string) => void
  isValidConnection: (connection: Connection | ModuleGraphEdge) => boolean
}) {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<ModuleGraphNode, ModuleGraphEdge> | null>(null)
  const [quickCreateState, setQuickCreateState] = useState<QuickCreateState | null>(null)
  const [actionMenuState, setActionMenuState] = useState<ActionMenuState | null>(null)
  const suppressNextPaneClickRef = useRef(false)
  const pendingConnectionStartRef = useRef<PendingConnectionStart | null>(null)
  const connectionStartPointRef = useRef<{ x: number; y: number } | null>(null)

  const recommendedModules = useMemo(
    () => getRecommendedModulesFromConnectionStart(modules, nodes, quickCreateState?.connectionStart ?? null),
    [modules, nodes, quickCreateState?.connectionStart],
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
      nodeName: node.data.module.name,
    })
  }, [reactFlowInstance])

  return (
    <div className="relative h-[760px] overflow-hidden rounded-sm border border-border bg-surface-lowest">
      <ReactFlow
        className="theme-graph-flow"
        nodes={nodes}
        edges={edges}
        onInit={setReactFlowInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(event, node) => {
          closeQuickCreateMenu()
          onNodeSelect(node.id)
          openNodeActionMenu(event, node)
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault()
          closeQuickCreateMenu()
          onNodeSelect(node.id)
          openNodeActionMenu(event, node)
        }}
        onEdgeClick={(_, edge) => {
          closeQuickCreateMenu()
          closeActionMenu()
          onEdgeSelect(edge.id)
        }}
        onPaneClick={() => {
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
          closeQuickCreateMenu()
          onPaneSelect()
          openPaneActionMenu(event)
        }}
        onConnectStart={(event, params) => {
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
