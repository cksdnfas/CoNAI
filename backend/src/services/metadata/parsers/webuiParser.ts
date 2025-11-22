/**
 * WebUI Metadata Parser
 * Parses Stable Diffusion WebUI parameters format
 * Based on NAI-Tag-Viewer parsing logic
 */

import { AIMetadata, LoRAModel, ModelReference } from '../types';

export class WebUIParser {
  /**
   * Sanitize text by removing null bytes and normalizing Unicode
   * Preserves Korean, Japanese, Chinese and other Unicode characters
   */
  private static sanitizeText(text: string): string {
    // Remove null bytes that can cause issues
    let sanitized = text.replace(/\u0000/g, '');

    // Normalize Unicode to NFC form (important for Korean/Japanese/Chinese)
    sanitized = sanitized.normalize('NFC');

    return sanitized;
  }

  /**
   * Check if data is WebUI format
   */
  static isWebUIFormat(data: any): boolean {
    if (typeof data === 'string') {
      // WebUI format: contains "parameters" or "Steps:" pattern
      return (
        data.includes('parameters') ||
        (data.includes('Steps:') && data.includes('Sampler:'))
      );
    }

    if (typeof data === 'object' && data !== null) {
      // Direct parameters property
      if (data.parameters !== undefined) {
        return true;
      }

      // Nested in textChunks (common in PNG metadata)
      if (data.textChunks && typeof data.textChunks === 'object') {
        if (data.textChunks.parameters !== undefined) {
          return true;
        }
      }

      return false;
    }

    return false;
  }

  /**
   * Parse WebUI metadata
   */
  static parse(data: any): AIMetadata {
    try {
      let parametersText: string;

      // Extract parameters text
      if (typeof data === 'string') {
        parametersText = data;
      } else if (data.parameters) {
        parametersText = data.parameters;
      } else if (data.textChunks?.parameters) {
        // Handle nested textChunks structure
        parametersText = data.textChunks.parameters;
      } else {
        return {};
      }

      // Remove 'parameters' prefix if present
      if (parametersText.startsWith('parameters')) {
        parametersText = parametersText.substring('parameters'.length);
      }

      // Parse using line-by-line method (NAI-Tag-Viewer style)
      return this.parseParametersText(parametersText);
    } catch (error) {
      console.warn('WebUI parsing error:', error);
      return {};
    }
  }

  /**
   * Parse WebUI parameters text (line-by-line parsing)
   */
  private static parseParametersText(text: string): AIMetadata {
    const aiInfo: AIMetadata = {};

    // Split into lines
    const lines = text.split(/\r?\n/);

    // Find "Negative prompt:" line
    let negPromptIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('Negative prompt:')) {
        negPromptIndex = i;
        break;
      }
    }

    // Extract prompts
    if (negPromptIndex > 0) {
      // Positive prompt: all lines before "Negative prompt:"
      const positiveLines = lines.slice(0, negPromptIndex);
      aiInfo.positive_prompt = this.sanitizeText(positiveLines.join('\n').trim());
      aiInfo.prompt = aiInfo.positive_prompt;

      // Negative prompt: text after "Negative prompt:" on that line
      const negLine = lines[negPromptIndex];
      aiInfo.negative_prompt = this.sanitizeText(
        negLine.substring('Negative prompt:'.length).trim()
      );

      // Options: lines after negative prompt
      const optionLines = lines.slice(negPromptIndex + 1);
      this.parseOptionLines(optionLines, aiInfo);
    } else {
      // No negative prompt - all text is positive prompt
      aiInfo.positive_prompt = this.sanitizeText(text.trim());
      aiInfo.prompt = aiInfo.positive_prompt;
      aiInfo.negative_prompt = '';
    }

    // Extract LoRA models from positive prompt
    if (aiInfo.positive_prompt) {
      const loras = this.extractLoRAInfo(aiInfo.positive_prompt);
      if (loras.length > 0) {
        aiInfo.lora_models = loras;
      }
    }

    // Build model_references for Civitai integration
    aiInfo.model_references = this.buildModelReferences(aiInfo);

    return aiInfo;
  }

  /**
   * Parse option lines (comma-separated key:value pairs)
   */
  private static parseOptionLines(lines: string[], aiInfo: AIMetadata): void {
    const optionText = lines.join(' ').trim();
    if (!optionText) return;

    // Split by comma
    const parts = optionText.split(',');

    for (const part of parts) {
      const trimmedPart = part.trim();
      if (!trimmedPart || !trimmedPart.includes(':')) continue;

      const colonIndex = trimmedPart.indexOf(':');
      const key = trimmedPart.substring(0, colonIndex).trim();
      const value = this.sanitizeText(trimmedPart.substring(colonIndex + 1).trim());

      // Parse specific fields
      this.parseOptionField(key, value, aiInfo);
    }
  }

  /**
   * Parse individual option field
   */
  private static parseOptionField(key: string, value: string, aiInfo: AIMetadata): void {
    const keyLower = key.toLowerCase();

    // Try to convert to number
    let numValue: number | undefined;
    try {
      if (value.includes('.')) {
        numValue = parseFloat(value);
      } else {
        const parsed = parseInt(value);
        if (!isNaN(parsed)) {
          numValue = parsed;
        }
      }
    } catch {
      // Keep as string
    }

    // Map fields
    switch (keyLower) {
      case 'steps':
        aiInfo.steps = numValue;
        break;
      case 'sampler':
        aiInfo.sampler = value;
        break;
      case 'cfg scale':
        aiInfo.cfg_scale = numValue;
        break;
      case 'seed':
        aiInfo.seed = numValue;  // Use number value
        break;
      case 'size':
        const [width, height] = value.split('x').map(Number);
        if (width && height) {
          aiInfo.width = width;
          aiInfo.height = height;
        }
        break;
      case 'model':
        aiInfo.model = value;
        break;
      case 'model hash':
        aiInfo.model_hash = value;
        break;
      case 'denoising strength':
        aiInfo.denoising_strength = numValue;
        break;
      case 'clip skip':
        aiInfo.clip_skip = numValue;
        break;
      case 'lora hashes':
        aiInfo.lora_hashes = value.replace(/"/g, '');
        break;
      case 'version':
        aiInfo.version = value;
        break;
      default:
        // Store unknown fields
        aiInfo[key] = numValue !== undefined ? numValue : value;
        break;
    }
  }

  /**
   * Extract LoRA information from prompt
   * Returns array of LoRA names (for compatibility)
   */
  private static extractLoRAInfo(prompt: string): string[] {
    const loraRegex = /<lora:([^:]+):([\d.]+)>/g;
    const loras: string[] = [];
    let match;

    while ((match = loraRegex.exec(prompt)) !== null) {
      loras.push(match[1]);  // Only store name for compatibility
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
        weight: parseFloat(match[2])
      });
    }

    return loras;
  }

  /**
   * Parse lora_hashes string into a map
   * Format: "name1: hash1, name2: hash2"
   */
  private static parseLoraHashes(loraHashesStr: string): Map<string, string> {
    const hashMap = new Map<string, string>();
    if (!loraHashesStr) return hashMap;

    // Split by comma, then parse each pair
    const pairs = loraHashesStr.split(',');
    for (const pair of pairs) {
      const trimmed = pair.trim();
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const name = trimmed.substring(0, colonIndex).trim();
        const hash = trimmed.substring(colonIndex + 1).trim();
        if (name && hash) {
          hashMap.set(name, hash);
        }
      }
    }

    return hashMap;
  }

  /**
   * Build model_references array for Civitai integration
   */
  private static buildModelReferences(aiInfo: AIMetadata): ModelReference[] {
    const refs: ModelReference[] = [];

    // 1. Add base model if hash exists
    if (aiInfo.model_hash) {
      refs.push({
        name: aiInfo.model || 'Unknown Model',
        hash: aiInfo.model_hash,
        type: 'checkpoint'
      });
    }

    // 2. Add LoRA models with hashes
    const loraHashMap = this.parseLoraHashes(aiInfo.lora_hashes || '');

    if (aiInfo.positive_prompt) {
      const lorasWithWeights = this.extractLoRAInfoWithWeights(aiInfo.positive_prompt);

      for (const lora of lorasWithWeights) {
        const hash = loraHashMap.get(lora.name);
        if (hash) {
          refs.push({
            name: lora.name,
            hash: hash,
            type: 'lora',
            weight: lora.weight
          });
        }
      }
    }

    return refs;
  }
}
