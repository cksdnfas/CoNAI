/**
 * ComfyUI Workflow Parser Utility
 * Extracts generation parameters from ComfyUI workflow JSON
 */

export interface WorkflowExtractionResult {
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed?: number;
  steps?: number;
  cfg_scale?: number;
  sampler?: string;
  scheduler?: string;
  model?: string;
}

export class ComfyUIWorkflowParser {
  /**
   * Extract generation parameters from ComfyUI workflow
   * @param workflow - ComfyUI workflow JSON object
   * @returns Extracted parameters
   */
  static extractParameters(workflow: any): WorkflowExtractionResult {
    const result: WorkflowExtractionResult = {
      positivePrompt: '',
      negativePrompt: '',
      width: 512,
      height: 512
    };

    if (!workflow || typeof workflow !== 'object') {
      return result;
    }

    try {
      // Iterate through workflow nodes
      for (const [nodeId, node] of Object.entries(workflow)) {
        if (!node || typeof node !== 'object') continue;
        const nodeData = node as any;

        // Extract prompts from CLIPTextEncode nodes
        if (nodeData.class_type === 'CLIPTextEncode') {
          const text = nodeData.inputs?.text;
          if (typeof text === 'string') {
            // Heuristic: Longer prompts are usually positive, shorter are negative
            // Or check node title/label if available
            if (result.positivePrompt === '' || text.length > result.positivePrompt.length) {
              if (result.positivePrompt !== '') {
                result.negativePrompt = result.positivePrompt;
              }
              result.positivePrompt = text;
            } else {
              result.negativePrompt = text;
            }
          }
        }

        // Extract dimensions from EmptyLatentImage or KSampler
        if (nodeData.class_type === 'EmptyLatentImage') {
          const width = nodeData.inputs?.width;
          const height = nodeData.inputs?.height;
          if (typeof width === 'number') result.width = width;
          if (typeof height === 'number') result.height = height;
        }

        // Extract sampling parameters from KSampler
        if (nodeData.class_type === 'KSampler' || nodeData.class_type === 'KSamplerAdvanced') {
          const seed = nodeData.inputs?.seed;
          const steps = nodeData.inputs?.steps;
          const cfg = nodeData.inputs?.cfg;
          const sampler = nodeData.inputs?.sampler_name;
          const scheduler = nodeData.inputs?.scheduler;

          if (typeof seed === 'number') result.seed = seed;
          if (typeof steps === 'number') result.steps = steps;
          if (typeof cfg === 'number') result.cfg_scale = cfg;
          if (typeof sampler === 'string') result.sampler = sampler;
          if (typeof scheduler === 'string') result.scheduler = scheduler;
        }

        // Extract model from CheckpointLoaderSimple
        if (nodeData.class_type === 'CheckpointLoaderSimple') {
          const ckptName = nodeData.inputs?.ckpt_name;
          if (typeof ckptName === 'string') {
            result.model = ckptName;
          }
        }
      }
    } catch (error) {
      console.error('[WorkflowParser] Failed to parse workflow:', error);
    }

    return result;
  }

  /**
   * Find nodes by class type
   * @param workflow - ComfyUI workflow JSON object
   * @param classType - Node class type to search for
   * @returns Array of matching nodes
   */
  static findNodesByType(workflow: any, classType: string): any[] {
    const nodes: any[] = [];

    if (!workflow || typeof workflow !== 'object') {
      return nodes;
    }

    try {
      for (const [nodeId, node] of Object.entries(workflow)) {
        if (!node || typeof node !== 'object') continue;
        const nodeData = node as any;

        if (nodeData.class_type === classType) {
          nodes.push({ id: nodeId, ...nodeData });
        }
      }
    } catch (error) {
      console.error(`[WorkflowParser] Failed to find nodes of type ${classType}:`, error);
    }

    return nodes;
  }

  /**
   * Apply prompt_data substitutions to workflow
   * @param workflow - ComfyUI workflow JSON object
   * @param promptData - Prompt data with substitutions
   * @returns Workflow with substitutions applied
   */
  static applyPromptData(workflow: any, promptData: Record<string, any>): any {
    if (!workflow || typeof workflow !== 'object') {
      return workflow;
    }

    try {
      // Deep clone workflow to avoid mutations
      const substitutedWorkflow = JSON.parse(JSON.stringify(workflow));

      // Apply substitutions
      for (const [nodeId, node] of Object.entries(substitutedWorkflow)) {
        if (!node || typeof node !== 'object') continue;
        const nodeData = node as any;

        if (nodeData.inputs && typeof nodeData.inputs === 'object') {
          for (const [inputKey, inputValue] of Object.entries(nodeData.inputs)) {
            // Check if this input should be substituted
            if (promptData.hasOwnProperty(inputKey)) {
              nodeData.inputs[inputKey] = promptData[inputKey];
            }
          }
        }
      }

      return substitutedWorkflow;
    } catch (error) {
      console.error('[WorkflowParser] Failed to apply prompt data:', error);
      return workflow;
    }
  }

  /**
   * Extract and apply prompt_data, then extract final parameters
   * @param workflow - ComfyUI workflow JSON object
   * @param promptData - Prompt data with substitutions
   * @returns Extracted parameters after substitutions
   */
  static extractWithSubstitution(
    workflow: any,
    promptData: Record<string, any>
  ): WorkflowExtractionResult {
    const substitutedWorkflow = this.applyPromptData(workflow, promptData);
    return this.extractParameters(substitutedWorkflow);
  }
}
