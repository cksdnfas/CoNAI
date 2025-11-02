import React, { useEffect, useMemo, useState, useRef } from 'react';
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { Box, Typography, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import EnhancedCustomNode from './nodes/EnhancedCustomNode';
import GraphToolbar from './GraphToolbar';
import {
  parseNode,
  calculateNodeHeight,
  type EnhancedNodeData,
} from '../utils/nodeDataParser';
import { getDataTypeColor, getDataTypeLabel } from '../utils/dataTypeColors';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string;
  paramKey: string;
  paramValue: any;
  paramType: string;
}

interface EnhancedWorkflowGraphViewerProps {
  workflowJson: string | object;
  onParameterRightClick?: (nodeId: string, paramKey: string, paramValue: any, paramType: string) => void;
}

interface GraphNode extends Node {
  data: EnhancedNodeData;
}

interface GraphEdge extends Edge {
  dataType?: string;
}

/**
 * Parse ComfyUI workflow JSON to enhanced graph structure
 */
function parseWorkflowToGraph(workflowJson: string | object): { nodes: GraphNode[]; edges: GraphEdge[] } {
  try {
    const workflow = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson;

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Parse all nodes first
    Object.entries(workflow).forEach(([nodeId, nodeData]: [string, any]) => {
      const enhancedData = parseNode(nodeId, nodeData, workflow);
      const nodeHeight = calculateNodeHeight(enhancedData);

      nodes.push({
        id: nodeId,
        type: 'enhancedNode',
        position: enhancedData.position || { x: 0, y: 0 },
        data: enhancedData,
        style: {
          width: 250,
          height: nodeHeight,
        },
      });
    });

    // Create edges with proper handles and data types
    nodes.forEach((node) => {
      const connectionInputs = node.data.inputs.filter((i) => i.type === 'connection');

      connectionInputs.forEach((input) => {
        if (input.sourceNode) {
          const sourceNode = nodes.find((n) => n.id === input.sourceNode);
          const targetNodeId = node.id;

          // Find matching output slot
          const sourceOutput = sourceNode?.data.outputs[input.sourceSlot || 0];
          const dataType = input.dataType || sourceOutput?.dataType || 'UNKNOWN';

          edges.push({
            id: `${input.sourceNode}-${input.sourceSlot || 0}-${targetNodeId}-${input.name}`,
            source: input.sourceNode,
            target: targetNodeId,
            sourceHandle: `output-${input.sourceSlot || 0}`,
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
          });
        }
      });
    });

    return { nodes, edges };
  } catch (error) {
    console.error('Failed to parse workflow:', error);
    return { nodes: [], edges: [] };
  }
}

/**
 * Apply dagre layout algorithm to nodes with dynamic heights
 */
function getLayoutedElements(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: 'TB' | 'LR' = 'LR'
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, ranksep: 150, nodesep: 80 });

  nodes.forEach((node) => {
    const height = node.style?.height || calculateNodeHeight(node.data);
    dagreGraph.setNode(node.id, { width: 250, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes: Node[] = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const height = node.style?.height || calculateNodeHeight(node.data);

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 125, // Half of width (250/2)
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  const layoutedEdges: Edge[] = edges.map((edge) => ({
    ...edge,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: edge.style?.stroke || '#757575',
    },
  }));

  return { nodes: layoutedNodes, edges: layoutedEdges };
}

// We'll create nodeTypes inside the component to pass callbacks
const createNodeTypes = (onParameterContextMenu: (nodeId: string, paramKey: string, paramValue: any, paramType: string, event: React.MouseEvent) => void) => ({
  enhancedNode: (props: any) => (
    <EnhancedCustomNode {...props} onParameterContextMenu={onParameterContextMenu} />
  ),
});

const EnhancedWorkflowGraphViewer: React.FC<EnhancedWorkflowGraphViewerProps> = ({
  workflowJson,
  onParameterRightClick
}) => {
  const [layoutDirection, setLayoutDirection] = useState<'LR' | 'TB'>('LR');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuAnchorRef = useRef<{ top: number; left: number } | null>(null);

  const { nodes: parsedNodes, edges: parsedEdges } = useMemo(
    () => parseWorkflowToGraph(workflowJson),
    [workflowJson]
  );

  // Extract unique node types for filtering
  const availableNodeTypes = useMemo(() => {
    const types = new Set<string>();
    parsedNodes.forEach((node) => {
      const mainType = node.data.classType.split(/(?=[A-Z])/).slice(0, 2).join('');
      types.add(mainType);
    });
    return Array.from(types).sort();
  }, [parsedNodes]);

  // Filter nodes based on search and type filters
  const filteredNodes = useMemo(() => {
    return parsedNodes.filter((node) => {
      // Search filter
      const matchesSearch = searchTerm === '' ||
        node.data.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        node.data.classType.toLowerCase().includes(searchTerm.toLowerCase()) ||
        node.data.nodeId.includes(searchTerm);

      // Type filter
      const matchesType = typeFilters.length === 0 ||
        typeFilters.some((type) => node.data.classType.includes(type));

      return matchesSearch && matchesType;
    });
  }, [parsedNodes, searchTerm, typeFilters]);

  // Filter edges to only show connections between visible nodes
  const filteredEdges = useMemo(() => {
    const visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
    return parsedEdges.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );
  }, [parsedEdges, filteredNodes]);

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(filteredNodes, filteredEdges, layoutDirection),
    [filteredNodes, filteredEdges, layoutDirection]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  // Handle parameter right-click
  const handleParameterContextMenu = (
    nodeId: string,
    paramKey: string,
    paramValue: any,
    paramType: string,
    event: React.MouseEvent
  ) => {
    event.preventDefault();
    event.stopPropagation();

    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      nodeId,
      paramKey,
      paramValue,
      paramType,
    });

    menuAnchorRef.current = {
      top: event.clientY,
      left: event.clientX,
    };
  };

  // Handle menu action
  const handleAddToMarkedFields = () => {
    if (contextMenu && onParameterRightClick) {
      onParameterRightClick(
        contextMenu.nodeId,
        contextMenu.paramKey,
        contextMenu.paramValue,
        contextMenu.paramType
      );
    }
    setContextMenu(null);
  };

  // Close context menu
  const handleCloseContextMenu = () => {
    setContextMenu(null);
    menuAnchorRef.current = null;
  };

  // Create node types with callback
  const nodeTypesWithCallback = useMemo(
    () => createNodeTypes(handleParameterContextMenu),
    []
  );

  if (parsedNodes.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          p: 4,
        }}
      >
        <Typography variant="body1" color="text.secondary">
          No workflow data to display
        </Typography>
      </Box>
    );
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
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
        style={{
          backgroundColor: '#1a1a1a',
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="#404040"
          style={{ backgroundColor: '#1a1a1a' }}
        />
        <Controls
          style={{
            button: {
              backgroundColor: '#2a2a2a',
              border: '1px solid #404040',
              color: '#ffffff',
            },
          }}
        />
        <MiniMap
          nodeColor={(node) => {
            const enhancedNode = node as GraphNode;
            return getNodeColor(enhancedNode.data?.classType || '');
          }}
          maskColor="rgba(255, 255, 255, 0.05)"
          style={{
            backgroundColor: '#2a2a2a',
            border: '1px solid #404040',
          }}
        />
      </ReactFlow>

      {/* Toolbar */}
      <GraphToolbar
        onSearchChange={setSearchTerm}
        onFilterChange={setTypeFilters}
        onLayoutChange={setLayoutDirection}
        nodeTypes={availableNodeTypes}
        layout={layoutDirection}
      />

      {/* Stats display */}
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
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.75rem',
            color: '#ffffff',
          }}
        >
          📊 Nodes: {nodes.length} / {parsedNodes.length} | Edges: {edges.length} / {parsedEdges.length}
        </Typography>
      </Box>

      {/* Context Menu */}
      <Menu
        open={contextMenu?.visible || false}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          menuAnchorRef.current
            ? { top: menuAnchorRef.current.top, left: menuAnchorRef.current.left }
            : undefined
        }
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
          <ListItemText
            primary="Add to Marked Fields"
            sx={{ color: '#ffffff' }}
          />
        </MenuItem>
      </Menu>
    </Box>
  );
};

/**
 * Get node color for MiniMap (extracted from CustomNode logic)
 */
function getNodeColor(classType: string): string {
  if (classType.includes('Loader') || classType.includes('Load')) return '#4CAF50';
  if (classType.includes('Sampler')) return '#2196F3';
  if (classType.includes('Text') || classType.includes('CLIP')) return '#FF9800';
  if (classType.includes('VAE')) return '#9C27B0';
  if (classType.includes('Save') || classType.includes('Output')) return '#F44336';
  if (classType.includes('Latent')) return '#00BCD4';
  if (classType.includes('Image')) return '#673AB7';
  return '#757575';
}

export default EnhancedWorkflowGraphViewer;
