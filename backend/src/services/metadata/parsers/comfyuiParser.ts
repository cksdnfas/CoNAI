/**
 * ComfyUI Workflow Parser
 * Parses ComfyUI workflow JSON to extract prompt and generation parameters
 */

import { AIMetadata, ModelReference } from '../types';
import { logger } from '../../../utils/logger';

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
      logger.warn('ComfyUI workflow parsing error:', error);
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
        const text = this.resolveTextValue(workflow, inputs.text);
        if (text) {
          clipTextEncodeNodes.push({
            nodeId,
            text
          });
        }
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

    const outputSamplerTrace = this.findOutputSamplerTrace(workflow);
    const selectedSamplerNode = outputSamplerTrace?.samplerNode || samplerNode;

    // Prefer the conditioning inputs of the sampler that produced the saved image.
    // For ComfyUI PNGs this avoids unrelated prompt nodes from side branches.
    const samplerPositivePrompt = this.resolvePromptFromConditioning(workflow, selectedSamplerNode?.inputs?.positive);
    const samplerNegativePrompt = this.resolvePromptFromConditioning(workflow, selectedSamplerNode?.inputs?.negative);

    if (samplerPositivePrompt) {
      aiInfo.positive_prompt = samplerPositivePrompt;
      aiInfo.prompt = samplerPositivePrompt;
    }

    if (samplerNegativePrompt) {
      aiInfo.negative_prompt = samplerNegativePrompt;
    }

    // Fallback: convention-based CLIPTextEncode order for simple workflows.
    if (!aiInfo.positive_prompt && clipTextEncodeNodes.length > 0) {
      aiInfo.positive_prompt = clipTextEncodeNodes[0].text;
      aiInfo.prompt = aiInfo.positive_prompt;
    }

    if (!aiInfo.negative_prompt && clipTextEncodeNodes.length > 1) {
      aiInfo.negative_prompt = clipTextEncodeNodes[1].text;
    }

    if (aiInfo.positive_prompt || aiInfo.negative_prompt) {
      logger.debug(`✅ [ComfyUIParser] Extracted prompts from workflow`);
    }

    // Process sampler parameters
    if (selectedSamplerNode?.inputs) {
      const inputs = selectedSamplerNode.inputs;

      if (inputs.seed !== undefined) {
        aiInfo.seed = this.resolveNumericValue(workflow, inputs.seed);
      }

      if (inputs.steps !== undefined) {
        aiInfo.steps = this.resolveNumericValue(workflow, inputs.steps);
      }

      if (inputs.cfg !== undefined) {
        aiInfo.cfg_scale = this.resolveNumericValue(workflow, inputs.cfg);
      }

      if (inputs.sampler_name !== undefined) {
        aiInfo.sampler = this.resolveStringValue(workflow, inputs.sampler_name);
      }

      if (inputs.scheduler !== undefined) {
        aiInfo.scheduler = this.resolveStringValue(workflow, inputs.scheduler);
      }

      if (inputs.denoise !== undefined) {
        aiInfo.denoising_strength = this.resolveNumericValue(workflow, inputs.denoise);
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
        aiInfo.width = this.resolveNumericValue(workflow, inputs.width);
      }

      if (inputs.height !== undefined) {
        aiInfo.height = this.resolveNumericValue(workflow, inputs.height);
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

  private static isNodeLink(value: unknown): value is [string | number, number] {
    return Array.isArray(value) && value.length >= 2 && (typeof value[0] === 'string' || typeof value[0] === 'number');
  }

  private static resolveLinkedNode(workflow: any, value: unknown): any | null {
    if (!this.isNodeLink(value)) {
      return null;
    }

    return workflow?.[String(value[0])] || null;
  }

  private static isSamplerNode(node: any): boolean {
    return Boolean(node && typeof node === 'object' && (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced'));
  }

  private static parseNodeOrder(nodeId: string): number {
    const match = nodeId.match(/^\d+/);
    return match ? Number(match[0]) : -1;
  }

  private static isImageOutputNode(node: any): boolean {
    if (!node || typeof node !== 'object') {
      return false;
    }

    const classType = typeof node.class_type === 'string' ? node.class_type : '';
    const normalizedClassType = classType.toLowerCase();
    const inputs = node.inputs || {};
    const hasImageInput = this.isNodeLink(inputs.images) || this.isNodeLink(inputs.image);

    return hasImageInput && (
      classType === 'SaveImage'
      || classType === 'PreviewImage'
      || (normalizedClassType.includes('save') && normalizedClassType.includes('image'))
    );
  }

  private static getPreferredSamplerTraceInputKeys(node: any): string[] {
    const classType = typeof node?.class_type === 'string' ? node.class_type : '';
    const normalizedClassType = classType.toLowerCase();

    if (classType === 'VAEDecode') {
      return ['samples'];
    }

    if (normalizedClassType.includes('upscale')) {
      return ['image', 'images', 'samples', 'latent', 'latent_image'];
    }

    return ['samples', 'latent', 'latent_image', 'image', 'images', 'pixels'];
  }

  private static shouldTraceSamplerInputKey(inputKey: string): boolean {
    return !['model', 'clip', 'vae', 'control_net', 'style_model', 'upscale_model'].includes(inputKey);
  }

  private static traceUpstreamForSampler(
    workflow: any,
    value: unknown,
    visited = new Set<string>(),
    depth = 0,
  ): { nodeId: string; node: any } | null {
    if (depth > 48 || !this.isNodeLink(value)) {
      return null;
    }

    const nodeId = String(value[0]);
    if (visited.has(nodeId)) {
      return null;
    }

    const node = workflow?.[nodeId];
    if (!node || typeof node !== 'object') {
      return null;
    }

    if (this.isSamplerNode(node)) {
      return { nodeId, node };
    }

    const inputs = node.inputs || {};
    if (!inputs || typeof inputs !== 'object') {
      return null;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(nodeId);

    const preferredKeys = this.getPreferredSamplerTraceInputKeys(node).filter((key) => Object.prototype.hasOwnProperty.call(inputs, key));
    const remainingKeys = Object.keys(inputs).filter((key) => !preferredKeys.includes(key) && this.shouldTraceSamplerInputKey(key));

    for (const inputKey of [...preferredKeys, ...remainingKeys]) {
      const traced = this.traceUpstreamForSampler(workflow, inputs[inputKey], nextVisited, depth + 1);
      if (traced) {
        return traced;
      }
    }

    return null;
  }

  private static findOutputSamplerTrace(workflow: any): { outputNodeId: string; samplerNodeId: string; samplerNode: any } | null {
    const candidates: Array<{ outputNodeId: string; samplerNodeId: string; samplerNode: any }> = [];
    const outputNodes = Object.entries(workflow || {})
      .filter(([, node]) => this.isImageOutputNode(node))
      .sort(([leftId], [rightId]) => this.parseNodeOrder(rightId) - this.parseNodeOrder(leftId));

    for (const [outputNodeId, outputNode] of outputNodes) {
      const inputs = (outputNode as any).inputs || {};
      for (const inputKey of ['images', 'image']) {
        const traced = this.traceUpstreamForSampler(workflow, inputs[inputKey]);
        if (traced) {
          candidates.push({
            outputNodeId,
            samplerNodeId: traced.nodeId,
            samplerNode: traced.node,
          });
          break;
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => {
      const outputOrder = this.parseNodeOrder(right.outputNodeId) - this.parseNodeOrder(left.outputNodeId);
      if (outputOrder !== 0) {
        return outputOrder;
      }
      return this.parseNodeOrder(right.samplerNodeId) - this.parseNodeOrder(left.samplerNodeId);
    });

    return candidates[0];
  }

  private static getLinkOutputIndex(value: unknown): number {
    if (!this.isNodeLink(value)) {
      return 0;
    }

    const outputIndex = value[1];
    if (typeof outputIndex === 'number' && Number.isFinite(outputIndex)) {
      return outputIndex;
    }

    const parsed = Number(outputIndex);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private static isPresentScalar(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
  }

  private static normalizePromptPart(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private static joinPromptParts(parts: string[]): string | undefined {
    const uniqueParts = Array.from(new Set(parts.map((part) => part.trim()).filter((part) => part.length > 0)));
    return uniqueParts.length > 0 ? uniqueParts.join(', ') : undefined;
  }

  private static resolveStringFunctionNode(workflow: any, inputs: any, visited: Set<string>): unknown {
    const textKeys = Object.keys(inputs || {})
      .filter((key) => key === 'text' || /^text_[a-z0-9]+$/i.test(key))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const parts: string[] = [];

    for (const key of textKeys) {
      const resolved = this.resolveValue(workflow, inputs[key], new Set(visited));
      const normalized = this.normalizePromptPart(resolved);
      if (normalized) {
        parts.push(normalized);
      }
    }

    return this.joinPromptParts(parts);
  }

  private static resolveStringSwitchNode(workflow: any, inputs: any, visited: Set<string>): unknown {
    const selectedRaw = inputs?.Input ?? inputs?.input ?? inputs?.select ?? inputs?.selected ?? 1;
    const selected = typeof selectedRaw === 'number' ? selectedRaw : Number(selectedRaw);
    const selectedKey = Number.isFinite(selected) ? `input${selected}` : undefined;

    if (selectedKey && inputs[selectedKey] !== undefined) {
      return this.resolveValue(workflow, inputs[selectedKey], new Set(visited));
    }

    const firstInputKey = Object.keys(inputs || {}).find((key) => /^input\d+$/i.test(key));
    return firstInputKey ? this.resolveValue(workflow, inputs[firstInputKey], new Set(visited)) : undefined;
  }

  private static resolveRgthreeSamplerConfigNode(workflow: any, inputs: any, visited: Set<string>, outputIndex: number): unknown {
    const outputKeyByIndex: Record<number, string> = {
      0: 'steps_total',
      1: 'refiner_step',
      2: 'cfg',
      3: 'sampler_name',
      4: 'scheduler',
    };
    const key = outputKeyByIndex[outputIndex];

    return key && inputs[key] !== undefined
      ? this.resolveValue(workflow, inputs[key], new Set(visited))
      : undefined;
  }

  private static parseSelectedSizeText(text: unknown): { width: number; height: number } | null {
    if (typeof text !== 'string') {
      return null;
    }

    const match = text.match(/\*(\d{2,5})x(\d{2,5})\*/i) || text.match(/(?:^|\n)(\d{2,5})x(\d{2,5})(?:\n|$)/i);
    if (!match) {
      return null;
    }

    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
  }

  private static resolveJojrRandomSizeNode(inputs: any, outputIndex: number): unknown {
    const size = this.parseSelectedSizeText(inputs?.display_text_widget);
    if (!size) {
      return undefined;
    }

    if (outputIndex === 0) {
      return size.width;
    }

    if (outputIndex === 1) {
      return size.height;
    }

    return undefined;
  }

  private static resolveKnownCustomNodeOutput(workflow: any, node: any, inputs: any, visited: Set<string>, outputIndex: number): unknown {
    const classType = typeof node?.class_type === 'string' ? node.class_type : '';
    const normalizedClassType = classType.toLowerCase();

    if (classType === 'StringFunction|pysssss') {
      return this.resolveStringFunctionNode(workflow, inputs, visited);
    }

    if (normalizedClassType.includes('string switch')) {
      return this.resolveStringSwitchNode(workflow, inputs, visited);
    }

    if (classType === 'KSampler Config (rgthree)') {
      return this.resolveRgthreeSamplerConfigNode(workflow, inputs, visited, outputIndex);
    }

    if (classType === 'JOJR_RandomSize') {
      return this.resolveJojrRandomSizeNode(inputs, outputIndex);
    }

    if (classType === 'Seed (rgthree)' && outputIndex === 0 && inputs?.seed !== undefined) {
      return this.resolveValue(workflow, inputs.seed, new Set(visited));
    }

    return undefined;
  }

  private static resolveScalarFromNode(workflow: any, node: any, visited: Set<string>, outputIndex = 0): unknown {
    if (!node || typeof node !== 'object') {
      return undefined;
    }

    const inputs = node.inputs || {};
    const customValue = this.resolveKnownCustomNodeOutput(workflow, node, inputs, visited, outputIndex);
    if (this.isPresentScalar(customValue)) {
      return customValue;
    }

    for (const key of ['populated_text', 'text', 'wildcard_text', 'string', 'value', 'seed', 'number', 'int', 'float']) {
      if (inputs[key] !== undefined) {
        const resolved = this.resolveValue(workflow, inputs[key], new Set(visited));
        if (this.isPresentScalar(resolved)) {
          return resolved;
        }
      }
    }

    // Cached custom-node output is a last-resort fallback. It can be stale after API export.
    const resultValue = inputs.result?.__value__;
    if (Array.isArray(resultValue) && resultValue.length > 0) {
      return resultValue[outputIndex] ?? resultValue[0];
    }

    return undefined;
  }

  private static resolveValue(workflow: any, value: unknown, visited = new Set<string>()): unknown {
    if (!this.isNodeLink(value)) {
      return value;
    }

    const nodeId = String(value[0]);
    if (visited.has(nodeId)) {
      return undefined;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(nodeId);
    return this.resolveScalarFromNode(workflow, this.resolveLinkedNode(workflow, value), nextVisited, this.getLinkOutputIndex(value));
  }

  private static resolveTextValue(workflow: any, value: unknown, visited = new Set<string>()): string | undefined {
    const resolved = this.resolveValue(workflow, value, visited);
    if (typeof resolved === 'string') {
      const trimmed = resolved.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    return undefined;
  }

  private static resolveStringValue(workflow: any, value: unknown, visited = new Set<string>()): string | undefined {
    const resolved = this.resolveValue(workflow, value, visited);
    if (typeof resolved === 'string') {
      return resolved;
    }

    if (typeof resolved === 'number' && Number.isFinite(resolved)) {
      return String(resolved);
    }

    return undefined;
  }

  private static resolveNumericValue(workflow: any, value: unknown, visited = new Set<string>()): number | undefined {
    const resolved = this.resolveValue(workflow, value, visited);
    if (typeof resolved === 'number' && Number.isFinite(resolved)) {
      return resolved;
    }

    if (typeof resolved === 'string' && resolved.trim()) {
      const parsed = Number(resolved);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private static collectPromptTextsFromConditioning(workflow: any, value: unknown, visited = new Set<string>()): string[] {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    }

    if (!this.isNodeLink(value)) {
      return [];
    }

    const nodeId = String(value[0]);
    if (visited.has(nodeId)) {
      return [];
    }

    const node = workflow?.[nodeId];
    if (!node || typeof node !== 'object') {
      return [];
    }

    const nextVisited = new Set(visited);
    nextVisited.add(nodeId);

    const inputs = node.inputs || {};
    if (node.class_type === 'CLIPTextEncode') {
      const text = this.resolveTextValue(workflow, inputs.text);
      return text ? [text] : [];
    }

    for (const key of ['populated_text', 'wildcard_text', 'text', 'prompt', 'positive', 'result']) {
      if (inputs[key] !== undefined) {
        const resolved = this.resolveTextValue(workflow, inputs[key]);
        if (resolved) {
          return [resolved];
        }
      }
    }

    const preferredConditioningKeys = [
      'conditioning',
      'conditioning_1',
      'conditioning_2',
      'conditioning_to',
      'conditioning_from',
      'positive',
      'negative',
    ];
    const candidateKeys = [
      ...preferredConditioningKeys.filter((key) => Object.prototype.hasOwnProperty.call(inputs, key)),
      ...Object.keys(inputs).filter((key) => !preferredConditioningKeys.includes(key) && this.shouldTraceSamplerInputKey(key)),
    ];
    const texts: string[] = [];

    for (const key of candidateKeys) {
      if (!this.isNodeLink(inputs[key])) {
        continue;
      }
      texts.push(...this.collectPromptTextsFromConditioning(workflow, inputs[key], nextVisited));
    }

    return texts;
  }

  private static resolvePromptFromConditioning(workflow: any, value: unknown): string | undefined {
    const texts = this.collectPromptTextsFromConditioning(workflow, value);
    const uniqueTexts = Array.from(new Set(texts.map((text) => text.trim()).filter((text) => text.length > 0)));
    if (uniqueTexts.length > 0) {
      return uniqueTexts.join(', ');
    }

    return this.resolveTextValue(workflow, value);
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
