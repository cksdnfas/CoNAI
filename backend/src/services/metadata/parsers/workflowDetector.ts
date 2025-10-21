/**
 * Workflow JSON Detector
 * Detects if a string is a ComfyUI workflow JSON
 */

export class WorkflowDetector {
  /**
   * Known ComfyUI node types
   */
  private static readonly KNOWN_NODE_TYPES = [
    'CLIPTextEncode',
    'KSampler',
    'KSamplerAdvanced',
    'EmptyLatentImage',
    'CheckpointLoaderSimple',
    'VAEDecode',
    'VAEEncode',
    'SaveImage',
    'LoadImage',
    'LoraLoader',
    'ControlNetLoader'
  ];

  /**
   * Check if text is a workflow JSON
   * @param text - Text to check
   * @returns true if workflow JSON
   */
  static isWorkflowJSON(text: string): boolean {
    if (!text || typeof text !== 'string') {
      return false;
    }

    try {
      const parsed = JSON.parse(text);

      // JSON must be an object
      if (typeof parsed !== 'object' || parsed === null) {
        return false;
      }

      // Check for ComfyUI workflow structure
      return this.hasComfyUINodes(parsed);
    } catch {
      // Not valid JSON
      return false;
    }
  }

  /**
   * Check if object has ComfyUI nodes
   * @param obj - Parsed JSON object
   * @returns true if ComfyUI nodes found
   */
  private static hasComfyUINodes(obj: any): boolean {
    // ComfyUI workflows have node IDs as keys
    // Each node has a "class_type" field
    for (const key in obj) {
      const node = obj[key];

      if (node && typeof node === 'object') {
        // Check for class_type field (required for ComfyUI nodes)
        if (node.class_type && typeof node.class_type === 'string') {
          console.log(`🔍 [WorkflowDetector] Found ComfyUI node: ${node.class_type}`);
          return true;
        }

        // Additional check: if node has "inputs" field (common in ComfyUI)
        if (node.inputs && typeof node.inputs === 'object') {
          // Verify it's a ComfyUI-style node structure
          if (node._meta || node.widgets_values) {
            console.log(`🔍 [WorkflowDetector] Found ComfyUI workflow structure`);
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if node type is a known ComfyUI node
   * @param classType - Node class type
   * @returns true if known ComfyUI node
   */
  static isKnownComfyUINode(classType: string): boolean {
    return this.KNOWN_NODE_TYPES.includes(classType);
  }

  /**
   * Extract workflow info for debugging
   * @param text - Workflow JSON text
   * @returns Workflow info or null
   */
  static extractWorkflowInfo(text: string): { nodeCount: number; nodeTypes: string[] } | null {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) {
        return null;
      }

      const nodeTypes: string[] = [];
      let nodeCount = 0;

      for (const key in parsed) {
        const node = parsed[key];
        if (node && typeof node === 'object' && node.class_type) {
          nodeCount++;
          if (!nodeTypes.includes(node.class_type)) {
            nodeTypes.push(node.class_type);
          }
        }
      }

      return { nodeCount, nodeTypes };
    } catch {
      return null;
    }
  }
}
