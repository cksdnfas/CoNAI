/**
 * Enhanced node data parser for ComfyUI workflows
 * Extracts comprehensive information from workflow nodes
 */

import { inferDataType } from './dataTypeColors';

export interface NodeInput {
  name: string;
  type: 'connection' | 'parameter';
  value?: any;
  dataType?: string;
  sourceNode?: string;
  sourceSlot?: number;
  required?: boolean;
}

export interface NodeOutput {
  name: string;
  slot: number;
  dataType: string;
}

export interface NodeWidget {
  name: string;
  value: any;
  type: string;
}

export interface EnhancedNodeData {
  nodeId: string;
  title: string;
  classType: string;
  inputs: NodeInput[];
  outputs: NodeOutput[];
  widgets: NodeWidget[];
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  color?: string;
  bgColor?: string;
  rawNode: any;
}

/**
 * Parse a single ComfyUI node to enhanced format
 */
export function parseNode(nodeId: string, nodeData: any, workflow: Record<string, any>): EnhancedNodeData {
  const inputs: NodeInput[] = [];
  const outputs: NodeOutput[] = [];
  const widgets: NodeWidget[] = [];

  // Extract title from metadata
  const title = nodeData._meta?.title || nodeData.title || `Node ${nodeId}`;

  // Parse inputs
  if (nodeData.inputs) {
    Object.entries(nodeData.inputs).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length >= 2) {
        // Connection input
        const sourceNodeId = String(value[0]);
        const sourceSlot = value[1] as number;
        const sourceNode = workflow[sourceNodeId];
        const dataType = inferDataType(key, value, sourceNode?.class_type);

        inputs.push({
          name: key,
          type: 'connection',
          dataType,
          sourceNode: sourceNodeId,
          sourceSlot,
        });
      } else {
        // Parameter input
        const dataType = inferDataType(key, value, nodeData.class_type);
        inputs.push({
          name: key,
          type: 'parameter',
          value,
          dataType,
        });
      }
    });
  }

  // Parse outputs (infer from class type)
  const outputInfo = inferOutputs(nodeData.class_type);
  outputInfo.forEach((output, index) => {
    outputs.push({
      name: output.name,
      slot: index,
      dataType: output.dataType,
    });
  });

  // Parse widgets (from widgets_values)
  if (nodeData.widgets_values && Array.isArray(nodeData.widgets_values)) {
    const widgetNames = inferWidgetNames(nodeData.class_type);
    nodeData.widgets_values.forEach((value: any, index: number) => {
      const name = widgetNames[index] || `widget_${index}`;
      const type = typeof value;
      widgets.push({ name, value, type });
    });
  }

  // Extract position and size from metadata
  const position = nodeData._meta?.position
    ? { x: nodeData._meta.position[0], y: nodeData._meta.position[1] }
    : undefined;

  const size = nodeData._meta?.size
    ? { width: nodeData._meta.size[0], height: nodeData._meta.size[1] }
    : undefined;

  return {
    nodeId,
    title,
    classType: nodeData.class_type,
    inputs,
    outputs,
    widgets,
    position,
    size,
    color: nodeData._meta?.color,
    bgColor: nodeData._meta?.bgcolor,
    rawNode: nodeData,
  };
}

/**
 * Infer output slots for common node types
 */
function inferOutputs(classType: string): Array<{ name: string; dataType: string }> {
  const type = classType.toLowerCase();

  // Checkpoint loaders
  if (type.includes('checkpointloader')) {
    return [
      { name: 'MODEL', dataType: 'MODEL' },
      { name: 'CLIP', dataType: 'CLIP' },
      { name: 'VAE', dataType: 'VAE' },
    ];
  }

  // LoRA loader
  if (type.includes('loraloader')) {
    return [
      { name: 'MODEL', dataType: 'MODEL' },
      { name: 'CLIP', dataType: 'CLIP' },
    ];
  }

  // CLIP text encode
  if (type.includes('cliptextencode')) {
    return [{ name: 'CONDITIONING', dataType: 'CONDITIONING' }];
  }

  // Samplers
  if (type.includes('sampler')) {
    return [{ name: 'LATENT', dataType: 'LATENT' }];
  }

  // VAE operations
  if (type.includes('vaedecode')) {
    return [{ name: 'IMAGE', dataType: 'IMAGE' }];
  }
  if (type.includes('vaeencode')) {
    return [{ name: 'LATENT', dataType: 'LATENT' }];
  }

  // Image operations
  if (type.includes('emptylatent')) {
    return [{ name: 'LATENT', dataType: 'LATENT' }];
  }
  if (type.includes('loadimage')) {
    return [
      { name: 'IMAGE', dataType: 'IMAGE' },
      { name: 'MASK', dataType: 'MASK' },
    ];
  }

  // ControlNet
  if (type.includes('controlnet')) {
    return [{ name: 'CONDITIONING', dataType: 'CONDITIONING' }];
  }

  // Default: single output
  return [{ name: 'OUTPUT', dataType: 'UNKNOWN' }];
}

/**
 * Infer widget names for common node types
 */
function inferWidgetNames(classType: string): string[] {
  const type = classType.toLowerCase();

  if (type.includes('cliptextencode')) {
    return ['text'];
  }
  if (type.includes('checkpointloader')) {
    return ['ckpt_name'];
  }
  if (type.includes('loraloader')) {
    return ['lora_name', 'strength_model', 'strength_clip'];
  }
  if (type.includes('ksampler')) {
    return ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'];
  }
  if (type.includes('emptylatent')) {
    return ['width', 'height', 'batch_size'];
  }
  if (type.includes('saveimage')) {
    return ['filename_prefix'];
  }
  if (type.includes('loadimage')) {
    return ['image', 'upload'];
  }

  return [];
}

/**
 * Calculate dynamic node height based on content
 */
export function calculateNodeHeight(data: EnhancedNodeData): number {
  const BASE_HEIGHT = 40; // Header height
  const SECTION_HEADER = 28; // Section header height
  const ITEM_HEIGHT = 24; // Height per item
  const PADDING = 16; // Top and bottom padding

  let height = BASE_HEIGHT + PADDING;

  // Inputs section
  if (data.inputs.length > 0) {
    height += SECTION_HEADER;
    height += data.inputs.length * ITEM_HEIGHT;
  }

  // Widgets section
  if (data.widgets.length > 0) {
    height += SECTION_HEADER;
    height += data.widgets.length * ITEM_HEIGHT;
  }

  // Outputs section
  if (data.outputs.length > 0) {
    height += SECTION_HEADER;
    height += data.outputs.length * ITEM_HEIGHT;
  }

  // Min and max constraints
  return Math.max(120, Math.min(600, height));
}

/**
 * Get readable label for node class type
 */
export function getNodeLabel(classType: string): string {
  const labelMap: Record<string, string> = {
    CheckpointLoaderSimple: 'Checkpoint Loader',
    CheckpointLoader: 'Checkpoint Loader',
    CLIPTextEncode: 'CLIP Text Encode',
    KSampler: 'KSampler',
    KSamplerAdvanced: 'KSampler Advanced',
    EmptyLatentImage: 'Empty Latent Image',
    VAEDecode: 'VAE Decode',
    VAEEncode: 'VAE Encode',
    SaveImage: 'Save Image',
    LoadImage: 'Load Image',
    LoraLoader: 'LoRA Loader',
    ControlNetLoader: 'ControlNet Loader',
    ControlNetApply: 'Apply ControlNet',
    ImageScale: 'Image Scale',
    LatentUpscale: 'Latent Upscale',
    LatentUpscaleBy: 'Latent Upscale By',
  };

  return labelMap[classType] || classType;
}
