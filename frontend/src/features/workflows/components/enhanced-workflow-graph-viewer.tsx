import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  type Edge,
  type Node,
  type NodeTypes,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { Box, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import { Add as AddIcon } from '@mui/icons-material'
import EnhancedCustomNode from './nodes/enhanced-custom-node'
import GraphToolbar from './graph-toolbar'
import { calculateNodeHeight, parseNode, type EnhancedNodeData } from '@/features/workflows/utils/node-data-parser'
import { getDataTypeColor, getDataTypeLabel } from '@/features/workflows/utils/data-type-colors'

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  nodeId: string
  nodeTitle: string
  classType: string
  paramKey: string
  paramValue: unknown
  paramType: string
}

interface EnhancedWorkflowGraphViewerProps {
  workflowJson: string | object
  onParameterRightClick?: (
    nodeId: string,
    paramKey: string,
    paramValue: unknown,
    paramType: string,
    nodeTitle: string,
    classType: string,
  ) => void
}

interface GraphNode extends Node<EnhancedNodeData> {
  data: EnhancedNodeData
}

type GraphEdge = Edge & {
  dataType?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function parseWorkflowToGraph(workflowJson: string | object): { nodes: GraphNode[]; edges: GraphEdge[] } {
  try {
    const parsed = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson
    if (!isRecord(parsed)) {
      return { nodes: [], edges: [] }
    }

    const workflow: Record<string, Record<string, unknown>> = {}
    Object.entries(parsed).forEach(([nodeId, nodeData]) => {
      if (isRecord(nodeData)) {
        workflow[nodeId] = nodeData
      }
    })

    const nodes: GraphNode[] = Object.entries(workflow).map(([nodeId, nodeData]) => {
      const enhancedData = parseNode(nodeId, nodeData, workflow)
      const nodeHeight = calculateNodeHeight(enhancedData)
      return {
        id: nodeId,
        type: 'enhancedNode',
        position: enhancedData.position || { x: 0, y: 0 },
        data: enhancedData,
        style: {
          width: 250,
          height: nodeHeight,
        },
      }
    })

    const edges: GraphEdge[] = []
    nodes.forEach((node) => {
      const connectionInputs = node.data.inputs.filter((input) => input.type === 'connection')
      connectionInputs.forEach((input) => {
        if (!input.sourceNode) {
          return
        }

        const sourceNode = nodes.find((candidate) => candidate.id === input.sourceNode)
        const sourceSlot = typeof input.sourceSlot === 'number' ? input.sourceSlot : 0
        const sourceOutput = sourceNode?.data.outputs[sourceSlot]
        const dataType = input.dataType || sourceOutput?.dataType || 'UNKNOWN'

        edges.push({
          id: `${input.sourceNode}-${sourceSlot}-${node.id}-${input.name}`,
          source: input.sourceNode,
          target: node.id,
          sourceHandle: `output-${sourceSlot}`,
          targetHandle: `input-${input.name}`,
          label: getDataTypeLabel(dataType),
          dataType,
          type: 'smoothstep',
          style: {
            stroke: getDataTypeColor(dataType),
            strokeWidth: 2,
          },
          labelStyle: {
            fontSize: 10,
            fill: getDataTypeColor(dataType),
            fontWeight: 600,
          },
          labelBgStyle: {
            fill: '#ffffff',
            fillOpacity: 0.8,
          },
        })
      })
    })

    return { nodes, edges }
  } catch (error) {
    console.error('Failed to parse workflow:', error)
    return { nodes: [], edges: [] }
  }
}

function getLayoutedElements(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: 'TB' | 'LR' = 'LR',
): { nodes: Node[]; edges: GraphEdge[] } {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: direction, ranksep: 150, nodesep: 80 })

  nodes.forEach((node) => {
    const height = typeof node.style?.height === 'number' ? node.style.height : calculateNodeHeight(node.data)
    dagreGraph.setNode(node.id, { width: 250, height })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    const graphX = typeof nodeWithPosition?.x === 'number' ? nodeWithPosition.x : 0
    const graphY = typeof nodeWithPosition?.y === 'number' ? nodeWithPosition.y : 0
    const height = typeof node.style?.height === 'number' ? node.style.height : calculateNodeHeight(node.data)

    return {
      ...node,
      position: {
        x: graphX - 125,
        y: graphY - height / 2,
      },
    }
  })

  const layoutedEdges = edges.map((edge) => {
    const stroke = typeof edge.style?.stroke === 'string' ? edge.style.stroke : '#757575'
    return {
      ...edge,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
        color: stroke,
      },
    }
  })

  return { nodes: layoutedNodes, edges: layoutedEdges }
}

function getNodeColor(classType: string): string {
  if (classType.includes('Loader') || classType.includes('Load')) return '#4CAF50'
  if (classType.includes('Sampler')) return '#2196F3'
  if (classType.includes('Text') || classType.includes('CLIP')) return '#FF9800'
  if (classType.includes('VAE')) return '#9C27B0'
  if (classType.includes('Save') || classType.includes('Output')) return '#F44336'
  if (classType.includes('Latent')) return '#00BCD4'
  if (classType.includes('Image')) return '#673AB7'
  return '#757575'
}

export default function EnhancedWorkflowGraphViewer({ workflowJson, onParameterRightClick }: EnhancedWorkflowGraphViewerProps) {
  const [layoutDirection, setLayoutDirection] = useState<'LR' | 'TB'>('LR')
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilters, setTypeFilters] = useState<string[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const { nodes: parsedNodes, edges: parsedEdges } = useMemo(() => parseWorkflowToGraph(workflowJson), [workflowJson])

  const availableNodeTypes = useMemo(() => {
    const types = new Set<string>()
    parsedNodes.forEach((node) => {
      const mainType = node.data.classType.split(/(?=[A-Z])/).slice(0, 2).join('')
      types.add(mainType)
    })
    return Array.from(types).sort()
  }, [parsedNodes])

  const filteredNodes = useMemo(() => {
    return parsedNodes.filter((node) => {
      const lowerSearch = searchTerm.toLowerCase()
      const matchesSearch =
        searchTerm === '' ||
        node.data.title.toLowerCase().includes(lowerSearch) ||
        node.data.classType.toLowerCase().includes(lowerSearch) ||
        node.data.nodeId.includes(searchTerm)

      const matchesType = typeFilters.length === 0 || typeFilters.some((type) => node.data.classType.includes(type))

      return matchesSearch && matchesType
    })
  }, [parsedNodes, searchTerm, typeFilters])

  const filteredEdges = useMemo(() => {
    const visibleNodeIds = new Set(filteredNodes.map((node) => node.id))
    return parsedEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
  }, [parsedEdges, filteredNodes])

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(filteredNodes, filteredEdges, layoutDirection),
    [filteredNodes, filteredEdges, layoutDirection],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges)

  useEffect(() => {
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges])

  const handleParameterContextMenu = useCallback(
    (nodeId: string, paramKey: string, paramValue: unknown, paramType: string, event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const node = parsedNodes.find((candidate) => candidate.id === nodeId)
      const nodeTitle = node?.data.title || ''
      const classType = node?.data.classType || ''

      setContextMenu({
        visible: true,
        x: event.clientX,
        y: event.clientY,
        nodeId,
        nodeTitle,
        classType,
        paramKey,
        paramValue,
        paramType,
      })

    },
    [parsedNodes],
  )

  const handleAddToMarkedFields = () => {
    if (contextMenu && onParameterRightClick) {
      onParameterRightClick(
        contextMenu.nodeId,
        contextMenu.paramKey,
        contextMenu.paramValue,
        contextMenu.paramType,
        contextMenu.nodeTitle,
        contextMenu.classType,
      )
    }
    setContextMenu(null)
  }

  const handleCloseContextMenu = () => {
    setContextMenu(null)
  }

  const nodeTypesWithCallback = useMemo<NodeTypes>(
    () => ({
      enhancedNode: (props) => <EnhancedCustomNode {...props} onParameterContextMenu={handleParameterContextMenu} />,
    }),
    [handleParameterContextMenu],
  )

  if (parsedNodes.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', p: 4 }}>
        <Typography variant="body1" color="text.secondary">
          No workflow data to display
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative', bgcolor: '#1a1a1a' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypesWithCallback}
        fitView
        attributionPosition="bottom-left"
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        style={{ backgroundColor: '#1a1a1a' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#404040" style={{ backgroundColor: '#1a1a1a' }} />
        <Controls />
        <MiniMap
          nodeColor={(node) => getNodeColor((node.data as EnhancedNodeData | undefined)?.classType || '')}
          maskColor="rgba(255, 255, 255, 0.05)"
          style={{
            backgroundColor: '#2a2a2a',
            border: '1px solid #404040',
          }}
        />
      </ReactFlow>

      <GraphToolbar
        onSearchChange={setSearchTerm}
        onFilterChange={setTypeFilters}
        onLayoutChange={setLayoutDirection}
        nodeTypes={availableNodeTypes}
        layout={layoutDirection}
      />

      <Box
        sx={{
          position: 'absolute',
          top: 10,
          left: 10,
          bgcolor: 'rgba(42, 42, 42, 0.95)',
          p: 1,
          borderRadius: 1,
          border: '1px solid rgba(64, 64, 64, 0.5)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
          zIndex: 5,
        }}
      >
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.75rem', color: '#ffffff' }}>
          Nodes: {nodes.length} / {parsedNodes.length} | Edges: {edges.length} / {parsedEdges.length}
        </Typography>
      </Box>

      <Menu
        open={contextMenu?.visible || false}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined}
        slotProps={{
          paper: {
            sx: {
              bgcolor: '#2a2a2a',
              border: '1px solid #404040',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            },
          },
        }}
      >
        <MenuItem onClick={handleAddToMarkedFields}>
          <ListItemIcon>
            <AddIcon fontSize="small" sx={{ color: '#4caf50' }} />
          </ListItemIcon>
          <ListItemText primary="Add to Marked Fields" sx={{ color: '#ffffff' }} />
        </MenuItem>
      </Menu>
    </Box>
  )
}
