/**
 * ComfyUI Workflow Parser
 * Parses ComfyUI workflow JSON to extract prompt and generation parameters
 */

import { AIMetadata, ModelReference } from '../types';

export class ComfyUIParser {
  /**
   * Check if data is ComfyUI workflow format
   */
  static isComfyUIWorkflow(data: any): boolean {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return this.hasComfyUINodes(parsed);
      } catch {
        return false;
      }
    }

    if (typeof data === 'object' && data !== null) {
      // Check if it has comfyui_workflow property
      if (data.comfyui_workflow) {
        return true;
      }

      // Check if textChunks has prompt key with workflow
      if (data.textChunks?.prompt) {
        try {
          const parsed = JSON.parse(data.textChunks.prompt);
          return this.hasComfyUINodes(parsed);
        } catch {
          return false;
        }
      }

      // Direct workflow object
      return this.hasComfyUINodes(data);
    }

    return false;
  }

  /**
   * Check if object has ComfyUI nodes structure
   */
  private static hasComfyUINodes(obj: any): boolean {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    // ComfyUI workflows have node IDs as keys
    // Each node has a "class_type" field
    for (const key in obj) {
      const node = obj[key];
      if (node && typeof node === 'object' && node.class_type) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse ComfyUI workflow metadata
   */
  static parse(data: any): AIMetadata {
    try {
      let workflowJSON: string;

      // Extract workflow JSON string
      if (typeof data === 'string') {
        workflowJSON = data;
      } else if (data.comfyui_workflow) {
        workflowJSON = data.comfyui_workflow;
      } else if (data.textChunks?.prompt) {
        workflowJSON = data.textChunks.prompt;
      } else {
        // Already parsed object
        return this.parseWorkflowObject(data);
      }

      // Parse JSON (handle NaN values that ComfyUI sometimes uses in arrays)
      const sanitizedJSON = workflowJSON.replace(/NaN/g, 'null');
      const workflow = JSON.parse(sanitizedJSON);
      return this.parseWorkflowObject(workflow);
    } catch (error) {
      console.warn('ComfyUI workflow parsing error:', error);
      return {};
    }
  }

  /**
   * Parse ComfyUI workflow object to extract metadata
   */
  private static parseWorkflowObject(workflow: any): AIMetadata {
    const aiInfo: AIMetadata = {
      ai_tool: 'ComfyUI'
    };

    // Find all nodes
    const clipTextEncodeNodes: Array<{ nodeId: string; text: string }> = [];
    let samplerNode: any = null;
    let checkpointNode: any = null;
    let emptyLatentNode: any = null;

    for (const nodeId in workflow) {
      const node = workflow[nodeId];
      if (!node || typeof node !== 'object') continue;

      const classType = node.class_type;
      const inputs = node.inputs;

      // Extract prompts from CLIPTextEncode nodes
      if (classType === 'CLIPTextEncode' && inputs?.text) {
        clipTextEncodeNodes.push({
          nodeId,
          text: inputs.text
        });
      }

      // Extract sampler parameters
      if (classType === 'KSampler' || classType === 'KSamplerAdvanced') {
        samplerNode = node;
      }

      // Extract checkpoint/model info
      if (classType === 'CheckpointLoaderSimple' && inputs?.ckpt_name) {
        checkpointNode = node;
      }

      // Extract dimensions
      if (classType === 'EmptyLatentImage' && inputs) {
        emptyLatentNode = node;
      }
    }

    // Process CLIPTextEncode nodes for prompts
    // Convention: First node is positive, second is negative (most common pattern)
    if (clipTextEncodeNodes.length > 0) {
      aiInfo.positive_prompt = clipTextEncodeNodes[0].text;
      aiInfo.prompt = aiInfo.positive_prompt;

      if (clipTextEncodeNodes.length > 1) {
        aiInfo.negative_prompt = clipTextEncodeNodes[1].text;
      }

      console.log(`✅ [ComfyUIParser] Extracted ${clipTextEncodeNodes.length} prompts from CLIPTextEncode nodes`);
    }

    // Process sampler parameters
    if (samplerNode?.inputs) {
      const inputs = samplerNode.inputs;

      if (inputs.seed !== undefined) {
        // Handle array format: ["node_id", index] or direct value
        aiInfo.seed = Array.isArray(inputs.seed) ? inputs.seed[0] : inputs.seed;
      }

      if (inputs.steps !== undefined) {
        aiInfo.steps = Array.isArray(inputs.steps) ? inputs.steps[0] : inputs.steps;
      }

      if (inputs.cfg !== undefined) {
        aiInfo.cfg_scale = Array.isArray(inputs.cfg) ? inputs.cfg[0] : inputs.cfg;
      }

      if (inputs.sampler_name !== undefined) {
        aiInfo.sampler = Array.isArray(inputs.sampler_name) ? inputs.sampler_name[0] : inputs.sampler_name;
      }

      if (inputs.scheduler !== undefined) {
        aiInfo.scheduler = Array.isArray(inputs.scheduler) ? inputs.scheduler[0] : inputs.scheduler;
      }

      if (inputs.denoise !== undefined) {
        aiInfo.denoising_strength = Array.isArray(inputs.denoise) ? inputs.denoise[0] : inputs.denoise;
      }
    }

    // Process checkpoint/model
    if (checkpointNode?.inputs?.ckpt_name) {
      const ckptName = checkpointNode.inputs.ckpt_name;
      aiInfo.model = Array.isArray(ckptName) ? ckptName[0] : ckptName;
    }

    // Process dimensions
    if (emptyLatentNode?.inputs) {
      const inputs = emptyLatentNode.inputs;

      if (inputs.width !== undefined) {
        aiInfo.width = Array.isArray(inputs.width) ? inputs.width[0] : inputs.width;
      }

      if (inputs.height !== undefined) {
        aiInfo.height = Array.isArray(inputs.height) ? inputs.height[0] : inputs.height;
      }
    }

    // Extract LoRA models from positive prompt
    if (aiInfo.positive_prompt) {
      const loras = this.extractLoRAInfo(aiInfo.positive_prompt);
      if (loras.length > 0) {
        aiInfo.lora_models = loras;
      }
    }

    // Extract LoRA models from LoraLoader nodes
    const loraLoaderLoras = this.extractLoRAFromNodes(workflow);
    if (loraLoaderLoras.length > 0) {
      // Merge with prompt-extracted loras (avoid duplicates)
      const existingLoras = new Set(aiInfo.lora_models || []);
      for (const lora of loraLoaderLoras) {
        if (!existingLoras.has(lora)) {
          aiInfo.lora_models = aiInfo.lora_models || [];
          aiInfo.lora_models.push(lora);
        }
      }
    }

    // Build model_references for Civitai integration
    aiInfo.model_references = this.buildModelReferences(aiInfo, workflow);

    return aiInfo;
  }

  /**
   * Extract LoRA information from prompt
   * Returns array of LoRA names
   */
  private static extractLoRAInfo(prompt: string): string[] {
    const loraRegex = /<lora:([^:]+):([\d.]+)>/g;
    const loras: string[] = [];
    let match;

    while ((match = loraRegex.exec(prompt)) !== null) {
      loras.push(match[1]);
    }

    return loras;
  }

  /**
   * Extract LoRA models from LoraLoader nodes in workflow
   */
  private static extractLoRAFromNodes(workflow: any): string[] {
    const loras: string[] = [];

    for (const nodeId in workflow) {
      const node = workflow[nodeId];
      if (!node || typeof node !== 'object') continue;

      const classType = node.class_type;
      const inputs = node.inputs;

      // LoraLoader, LoraLoaderModelOnly, etc.
      if (classType && classType.toLowerCase().includes('lora') && inputs?.lora_name) {
        const loraName = Array.isArray(inputs.lora_name) ? inputs.lora_name[0] : inputs.lora_name;
        if (loraName && typeof loraName === 'string') {
          // Remove file extension if present
          const cleanName = loraName.replace(/\.(safetensors|ckpt|pt)$/i, '');
          loras.push(cleanName);
        }
      }
    }

    return loras;
  }

  /**
   * Extract LoRA info with weights from prompt
   */
  private static extractLoRAInfoWithWeights(prompt: string): Array<{ name: string; weight: number }> {
    const loraRegex = /<lora:([^:]+):([\d.]+)>/g;
    const loras: Array<{ name: string; weight: number }> = [];
    let match;

    while ((match = loraRegex.exec(prompt)) !== null) {
      loras.push({
        name: match[1],
        weight: parseFloat(match[2]) || 1.0
      });
    }

    return loras;
  }

  /**
   * Build model_references array for Civitai integration
   * Note: ComfyUI doesn't typically include model hashes in metadata,
   * so we extract what we can (model names) for potential future matching
   */
  private static buildModelReferences(aiInfo: AIMetadata, workflow: any): ModelReference[] {
    const refs: ModelReference[] = [];

    // 1. Add base checkpoint model if available
    if (aiInfo.model) {
      // Try to extract hash from model name if present (some workflows include it)
      const hashMatch = aiInfo.model.match(/\[([a-fA-F0-9]{8,})\]/);
      const hash = hashMatch ? hashMatch[1] : '';

      if (hash) {
        refs.push({
          name: aiInfo.model.replace(/\[([a-fA-F0-9]{8,})\]/, '').trim(),
          hash: hash,
          type: 'checkpoint'
        });
      }
    }

    // 2. Extract hashes from workflow nodes if available
    // Some ComfyUI setups store hash info in node metadata
    for (const nodeId in workflow) {
      const node = workflow[nodeId];
      if (!node || typeof node !== 'object') continue;

      const classType = node.class_type;
      const inputs = node.inputs;

      // Check for hash in checkpoint loader nodes
      if (classType === 'CheckpointLoaderSimple' && inputs?.ckpt_name) {
        const ckptName = Array.isArray(inputs.ckpt_name) ? inputs.ckpt_name[0] : inputs.ckpt_name;
        const hashMatch = ckptName?.match(/\[([a-fA-F0-9]{8,})\]/);
        if (hashMatch && !refs.some(r => r.hash === hashMatch[1])) {
          refs.push({
            name: ckptName.replace(/\[([a-fA-F0-9]{8,})\]/, '').replace(/\.(safetensors|ckpt)$/i, '').trim(),
            hash: hashMatch[1],
            type: 'checkpoint'
          });
        }
      }

      // Check for hash in LoRA loader nodes
      if (classType && classType.toLowerCase().includes('lora') && inputs?.lora_name) {
        const loraName = Array.isArray(inputs.lora_name) ? inputs.lora_name[0] : inputs.lora_name;
        const hashMatch = loraName?.match(/\[([a-fA-F0-9]{8,})\]/);
        if (hashMatch) {
          const cleanName = loraName.replace(/\[([a-fA-F0-9]{8,})\]/, '').replace(/\.(safetensors|ckpt|pt)$/i, '').trim();
          const strength = inputs.strength_model || inputs.strength || 1.0;

          if (!refs.some(r => r.hash === hashMatch[1])) {
            refs.push({
              name: cleanName,
              hash: hashMatch[1],
              type: 'lora',
              weight: typeof strength === 'number' ? strength : 1.0
            });
          }
        }
      }
    }

    // 3. Add LoRAs from prompt with weights (if they have hashes embedded)
    if (aiInfo.positive_prompt) {
      const lorasWithWeights = this.extractLoRAInfoWithWeights(aiInfo.positive_prompt);
      for (const lora of lorasWithWeights) {
        const hashMatch = lora.name.match(/\[([a-fA-F0-9]{8,})\]/);
        if (hashMatch && !refs.some(r => r.hash === hashMatch[1])) {
          refs.push({
            name: lora.name.replace(/\[([a-fA-F0-9]{8,})\]/, '').trim(),
            hash: hashMatch[1],
            type: 'lora',
            weight: lora.weight
          });
        }
      }
    }

    return refs;
  }
}
