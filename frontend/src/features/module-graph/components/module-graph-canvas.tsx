import { useMemo, useRef, useState } from 'react'
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Connection, type OnEdgesChange, type OnNodesChange, type ReactFlowInstance } from '@xyflow/react'
import type { ModuleDefinitionRecord } from '@/lib/api'
import { ModuleGraphQuickCreateMenu } from './module-graph-quick-create-menu'
import { ModuleGraphNodeCard } from './module-graph-node-card'
import { getModulePortCompatibility, parseHandleId, type ModuleGraphEdge, type ModuleGraphNode } from '../module-graph-shared'

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

/** Check whether one connect-end event landed on the blank graph surface rather than a node/handle. */
function isPaneLikeEventTarget(event: unknown) {
  if (!event || typeof event !== 'object' || !('target' in event)) {
    return false
  }

  const eventTarget = (event as { target?: EventTarget | null }).target
  if (!(eventTarget instanceof HTMLElement)) {
    return false
  }

  return Boolean(eventTarget.closest('.react-flow__pane, .react-flow__background'))
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
  isValidConnection: (connection: Connection | ModuleGraphEdge) => boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<ModuleGraphNode, ModuleGraphEdge> | null>(null)
  const [pendingConnectionStart, setPendingConnectionStart] = useState<PendingConnectionStart | null>(null)
  const [quickCreateState, setQuickCreateState] = useState<QuickCreateState | null>(null)

  const recommendedModules = useMemo(
    () => getRecommendedModulesFromConnectionStart(modules, nodes, quickCreateState?.connectionStart ?? null),
    [modules, nodes, quickCreateState?.connectionStart],
  )

  const closeQuickCreateMenu = () => {
    setQuickCreateState(null)
  }

  const openQuickCreateMenu = (
    event: unknown,
    mode: 'pane' | 'connect',
    connectionStart: PendingConnectionStart | null,
  ) => {
    const clientPoint = getEventClientPoint(event)
    if (!clientPoint || !containerRef.current || !reactFlowInstance) {
      return
    }

    const containerRect = containerRef.current.getBoundingClientRect()
    const flowPosition = reactFlowInstance.screenToFlowPosition({ x: clientPoint.x, y: clientPoint.y })
    const menuWidth = 360
    const menuHeightPadding = 24

    setQuickCreateState({
      mode,
      anchor: {
        x: Math.min(Math.max(clientPoint.x - containerRect.left, 8), Math.max(containerRect.width - menuWidth - 8, 8)),
        y: Math.min(Math.max(clientPoint.y - containerRect.top, 8), Math.max(containerRect.height - menuHeightPadding, 8)),
      },
      flowPosition,
      connectionStart,
    })
  }

  return (
    <div ref={containerRef} className="relative h-[760px] overflow-hidden rounded-sm border border-border bg-surface-lowest">
      <ReactFlow
        className="theme-graph-flow"
        nodes={nodes}
        edges={edges}
        onInit={setReactFlowInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          closeQuickCreateMenu()
          onNodeSelect(node.id)
        }}
        onEdgeClick={(_, edge) => {
          closeQuickCreateMenu()
          onEdgeSelect(edge.id)
        }}
        onPaneClick={() => {
          closeQuickCreateMenu()
          onPaneSelect()
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault()
          onPaneSelect()
          openQuickCreateMenu(event, 'pane', null)
        }}
        onConnectStart={(_, params) => {
          if (params.nodeId && params.handleId && (params.handleType === 'source' || params.handleType === 'target')) {
            const handleId = params.handleId
            setPendingConnectionStart({
              nodeId: params.nodeId,
              handleId,
              handleType: params.handleType,
            })
          }
        }}
        onConnectEnd={(event, connectionState) => {
          const landedOnPane = isPaneLikeEventTarget(event)

          if (pendingConnectionStart && landedOnPane && !connectionState?.isValid) {
            openQuickCreateMenu(event, 'connect', pendingConnectionStart)
          }

          setPendingConnectionStart(null)
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

      {quickCreateState ? (
        <ModuleGraphQuickCreateMenu
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
