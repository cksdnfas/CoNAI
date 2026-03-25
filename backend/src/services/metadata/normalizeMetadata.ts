import { AIMetadata } from './types';
import { WorkflowDetector } from './parsers/workflowDetector';
import { logger } from '../../utils/logger';

/**
 * Remove invalid workflow-json prompt fields from parsed metadata.
 */
function removeWorkflowJsonPrompts(aiInfo: AIMetadata): void {
  if (aiInfo.prompt && WorkflowDetector.isWorkflowJSON(aiInfo.prompt)) {
    const workflowInfo = WorkflowDetector.extractWorkflowInfo(aiInfo.prompt);
    console.warn(`⚠️ [MetadataExtractor] Workflow JSON detected - invalidating prompt`, workflowInfo);
    aiInfo.prompt = undefined;
    aiInfo.positive_prompt = undefined;
  }

  if (aiInfo.negative_prompt && WorkflowDetector.isWorkflowJSON(aiInfo.negative_prompt)) {
    logger.warn(`⚠️ [MetadataExtractor] Workflow JSON in negative prompt - invalidating`);
    aiInfo.negative_prompt = undefined;
  }
}

/**
 * Infer the originating AI tool when a parser did not assign one.
 */
function detectAiTool(aiInfo: AIMetadata): void {
  if (!aiInfo) return;
  if (aiInfo.ai_tool && aiInfo.ai_tool !== 'Unknown') return;

  const text = JSON.stringify(aiInfo).toLowerCase();

  if (text.includes('comfyui') || text.includes('comfy ui')) {
    aiInfo.ai_tool = 'ComfyUI';
  } else if (text.includes('novelai') || text.includes('novel ai')) {
    aiInfo.ai_tool = 'NovelAI';
  } else if (text.includes('automatic1111') || text.includes('webui')) {
    aiInfo.ai_tool = 'Automatic1111';
  } else if (text.includes('invokeai') || text.includes('invoke ai')) {
    aiInfo.ai_tool = 'InvokeAI';
  } else if (text.includes('midjourney')) {
    aiInfo.ai_tool = 'Midjourney';
  } else if (text.includes('dall-e') || text.includes('dalle')) {
    aiInfo.ai_tool = 'DALL-E';
  } else if (text.includes('stable diffusion') || text.includes('sd ')) {
    aiInfo.ai_tool = 'Stable Diffusion';
  } else {
    aiInfo.ai_tool = 'Unknown';
  }
}

/**
 * Extract LoRA model names from the positive prompt when needed.
 */
function processLoraModels(aiInfo: AIMetadata): void {
  if (!aiInfo) return;
  if (aiInfo.lora_models && Array.isArray(aiInfo.lora_models)) return;

  const promptText = aiInfo.positive_prompt || aiInfo.prompt;
  if (!promptText) return;

  const loraRegex = /<lora:([^:]+):([\d.]+)>/g;
  const loras: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = loraRegex.exec(promptText)) !== null) {
    loras.push(match[1]);
  }

  if (loras.length > 0) {
    aiInfo.lora_models = loras;
  }
}

/**
 * Normalize parsed metadata before returning it from extraction.
 */
export function normalizeExtractedMetadata(aiInfo: AIMetadata): AIMetadata {
  removeWorkflowJsonPrompts(aiInfo);
  detectAiTool(aiInfo);
  processLoraModels(aiInfo);
  return aiInfo;
}
