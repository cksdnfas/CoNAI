/**
 * ComfyUI Workflow Graph Parser
 * Converts ComfyUI workflow JSON to React Flow graph data structure
 */

export interface GraphNode {
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

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Parse ComfyUI workflow JSON and convert to graph structure
 */
export function parseWorkflowToGraph(workflowJson: string | object): GraphData {
  try {
    const workflow = typeof workflowJson === 'string'
      ? JSON.parse(workflowJson)
      : workflowJson;

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Process each node in the workflow
    Object.entries(workflow).forEach(([nodeId, nodeData]: [string, any]) => {
      // Create node
      nodes.push({
        id: nodeId,
        type: 'customNode',
        position: { x: 0, y: 0 }, // Will be calculated by layout algorithm
        data: {
          label: getNodeLabel(nodeData.class_type, nodeData.inputs),
          classType: nodeData.class_type,
          inputs: nodeData.inputs || {},
          rawNode: nodeData,
        },
      });

      // Extract edges from inputs
      if (nodeData.inputs) {
        Object.entries(nodeData.inputs).forEach(([inputKey, inputValue]) => {
          // Check if input is a connection (array format: ["source_node_id", slot_index])
          if (Array.isArray(inputValue) && inputValue.length >= 2) {
            const sourceNodeId = String(inputValue[0]);
            const sourceSlot = inputValue[1];

            edges.push({
              id: `${sourceNodeId}-${nodeId}-${inputKey}`,
              source: sourceNodeId,
              target: nodeId,
              sourceHandle: `output-${sourceSlot}`,
              targetHandle: `input-${inputKey}`,
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
  // Map common class types to readable names
  const labelMap: Record<string, string> = {
    'CheckpointLoaderSimple': 'Checkpoint Loader',
    'CLIPTextEncode': 'Text Encode',
    'KSampler': 'Sampler',
    'KSamplerAdvanced': 'Sampler (Advanced)',
    'EmptyLatentImage': 'Empty Latent',
    'VAEDecode': 'VAE Decode',
    'VAEEncode': 'VAE Encode',
    'SaveImage': 'Save Image',
    'LoadImage': 'Load Image',
    'LoraLoader': 'LoRA Loader',
    'ControlNetLoader': 'ControlNet Loader',
    'ImageScale': 'Image Scale',
  };

  let label = labelMap[classType] || classType;

  // Add additional context for specific nodes
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
 * Get node color based on class type category
 */
export function getNodeColor(classType: string): string {
  // Categorize nodes by function
  if (classType.includes('Loader') || classType.includes('Load')) {
    return '#4CAF50'; // Green for loaders
  } else if (classType.includes('Sampler')) {
    return '#2196F3'; // Blue for samplers
  } else if (classType.includes('Text') || classType.includes('CLIP')) {
    return '#FF9800'; // Orange for text/CLIP
  } else if (classType.includes('VAE') || classType.includes('Decode') || classType.includes('Encode')) {
    return '#9C27B0'; // Purple for VAE
  } else if (classType.includes('Save') || classType.includes('Output')) {
    return '#F44336'; // Red for output
  } else if (classType.includes('Latent')) {
    return '#00BCD4'; // Cyan for latent
  } else if (classType.includes('Image')) {
    return '#673AB7'; // Deep purple for image processing
  }

  return '#757575'; // Gray for unknown types
}

/**
 * Get node category for grouping
 */
export function getNodeCategory(classType: string): string {
  if (classType.includes('Loader') || classType.includes('Load')) {
    return 'Input';
  } else if (classType.includes('Sampler')) {
    return 'Generation';
  } else if (classType.includes('Text') || classType.includes('CLIP')) {
    return 'Conditioning';
  } else if (classType.includes('VAE')) {
    return 'Processing';
  } else if (classType.includes('Save') || classType.includes('Output')) {
    return 'Output';
  } else if (classType.includes('Latent')) {
    return 'Latent';
  }

  return 'Other';
}
