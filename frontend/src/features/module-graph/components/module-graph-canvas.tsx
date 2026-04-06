import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Connection, type OnEdgesChange, type OnNodesChange } from '@xyflow/react'
import { ModuleGraphNodeCard } from './module-graph-node-card'
import type { ModuleGraphEdge, ModuleGraphNode } from '../module-graph-shared'

const MODULE_GRAPH_NODE_TYPES = { module: ModuleGraphNodeCard }

/** Render the React Flow canvas for the module-graph editor. */
export function ModuleGraphCanvas({
  nodes,
  edges,
  reactFlowColorMode,
  onNodesChange,
  onEdgesChange,
  onNodeSelect,
  onEdgeSelect,
  onPaneSelect,
  onConnect,
  isValidConnection,
}: {
  nodes: ModuleGraphNode[]
  edges: ModuleGraphEdge[]
  reactFlowColorMode: 'light' | 'dark' | 'system'
  onNodesChange: OnNodesChange<ModuleGraphNode>
  onEdgesChange: OnEdgesChange<ModuleGraphEdge>
  onNodeSelect: (nodeId: string) => void
  onEdgeSelect: (edgeId: string) => void
  onPaneSelect: () => void
  onConnect: (connection: Connection) => void
  isValidConnection: (connection: Connection | ModuleGraphEdge) => boolean
}) {
  return (
    <div className="h-[760px] overflow-hidden rounded-sm border border-border bg-surface-lowest">
      <ReactFlow
        className="theme-graph-flow"
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          onNodeSelect(node.id)
        }}
        onEdgeClick={(_, edge) => {
          onEdgeSelect(edge.id)
        }}
        onPaneClick={onPaneSelect}
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
    </div>
  )
}
