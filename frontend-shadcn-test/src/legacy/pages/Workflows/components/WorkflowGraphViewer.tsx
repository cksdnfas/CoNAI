import React, { useEffect, useMemo } from 'react';
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
import { Box, Typography } from '@mui/material';
import CustomNode from './nodes/CustomNode';

interface WorkflowGraphViewerProps {
  workflowJson: string | object;
}

interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    classType: string;
    inputs: Record<string, any>;
    rawNode: any;
  };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

/**
 * Parse ComfyUI workflow JSON to graph structure
 */
function parseWorkflowToGraph(workflowJson: string | object): { nodes: GraphNode[]; edges: GraphEdge[] } {
  try {
    const workflow = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson;

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    Object.entries(workflow).forEach(([nodeId, nodeData]: [string, any]) => {
      nodes.push({
        id: nodeId,
        type: 'customNode',
        position: { x: 0, y: 0 },
        data: {
          label: getNodeLabel(nodeData.class_type, nodeData.inputs),
          classType: nodeData.class_type,
          inputs: nodeData.inputs || {},
          rawNode: nodeData,
        },
      });

      if (nodeData.inputs) {
        Object.entries(nodeData.inputs).forEach(([inputKey, inputValue]) => {
          if (Array.isArray(inputValue) && inputValue.length >= 2) {
            const sourceNodeId = String(inputValue[0]);
            edges.push({
              id: `${sourceNodeId}-${nodeId}-${inputKey}`,
              source: sourceNodeId,
              target: nodeId,
              label: inputKey,
            });
          }
        });
      }
    });

    return { nodes, edges };
  } catch (error) {
    console.error('Failed to parse workflow:', error);
    return { nodes: [], edges: [] };
  }
}

/**
 * Generate a readable label for a node
 */
function getNodeLabel(classType: string, inputs: Record<string, any>): string {
  const labelMap: Record<string, string> = {
    CheckpointLoaderSimple: 'Checkpoint Loader',
    CLIPTextEncode: 'Text Encode',
    KSampler: 'Sampler',
    KSamplerAdvanced: 'Sampler (Advanced)',
    EmptyLatentImage: 'Empty Latent',
    VAEDecode: 'VAE Decode',
    VAEEncode: 'VAE Encode',
    SaveImage: 'Save Image',
    LoadImage: 'Load Image',
    LoraLoader: 'LoRA Loader',
    ControlNetLoader: 'ControlNet Loader',
    ImageScale: 'Image Scale',
  };

  let label = labelMap[classType] || classType;

  if (classType === 'CLIPTextEncode' && inputs.text) {
    const text = String(inputs.text);
    const preview = text.length > 30 ? text.substring(0, 30) + '...' : text;
    label += `\n"${preview}"`;
  } else if (classType === 'CheckpointLoaderSimple' && inputs.ckpt_name) {
    label += `\n${inputs.ckpt_name}`;
  } else if (classType === 'EmptyLatentImage') {
    label += `\n${inputs.width || 512}x${inputs.height || 512}`;
  } else if (classType === 'KSampler' || classType === 'KSamplerAdvanced') {
    const steps = inputs.steps || '?';
    const cfg = inputs.cfg || '?';
    label += `\nSteps: ${steps}, CFG: ${cfg}`;
  }

  return label;
}

/**
 * Apply dagre layout algorithm to nodes
 */
function getLayoutedElements(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction: 'TB' | 'LR' = 'LR'
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, ranksep: 100, nodesep: 50 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 250, height: 120 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes: Node[] = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 125,
        y: nodeWithPosition.y - 60,
      },
    };
  });

  const layoutedEdges: Edge[] = edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    animated: true,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
    },
    style: {
      strokeWidth: 2,
    },
  }));

  return { nodes: layoutedNodes, edges: layoutedEdges };
}

const nodeTypes = {
  customNode: CustomNode,
};

const WorkflowGraphViewer: React.FC<WorkflowGraphViewerProps> = ({ workflowJson }) => {
  const { nodes: parsedNodes, edges: parsedEdges } = useMemo(
    () => parseWorkflowToGraph(workflowJson),
    [workflowJson]
  );

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(parsedNodes, parsedEdges),
    [parsedNodes, parsedEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

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
    <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const customNode = node as Node<{ classType: string }>;
            const classType = customNode.data?.classType || '';

            if (classType.includes('Loader') || classType.includes('Load')) return '#4CAF50';
            if (classType.includes('Sampler')) return '#2196F3';
            if (classType.includes('Text') || classType.includes('CLIP')) return '#FF9800';
            if (classType.includes('VAE')) return '#9C27B0';
            if (classType.includes('Save') || classType.includes('Output')) return '#F44336';
            if (classType.includes('Latent')) return '#00BCD4';
            if (classType.includes('Image')) return '#673AB7';

            return '#757575';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
      </ReactFlow>
    </Box>
  );
};

export default WorkflowGraphViewer;
