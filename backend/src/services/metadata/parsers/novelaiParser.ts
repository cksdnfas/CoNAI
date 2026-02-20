/**
 * NovelAI Metadata Parser
 * Parses NovelAI JSON metadata format
 */

import { AIMetadata } from '../types';

export class NovelAIParser {
  /**
   * Check if data is NovelAI format
   */
  static isNovelAIFormat(data: any): boolean {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return this.hasNovelAIFields(parsed) || this.hasCommentField(parsed);
      } catch {
        return false;
      }
    }

    if (typeof data === 'object' && data !== null) {
      // Check for Comment field (old NAI format)
      if (this.hasCommentField(data)) {
        return true;
      }

      // Check for direct NAI fields
      return this.hasNovelAIFields(data);
    }

    return false;
  }

  /**
   * Check if object has Comment field with NovelAI data
   */
  private static hasCommentField(obj: any): boolean {
    if (!obj.Comment) {
      return false;
    }

    try {
      const commentData = JSON.parse(obj.Comment);
      return this.hasNovelAIFields(commentData);
    } catch {
      return false;
    }
  }

  /**
   * Check if object has NovelAI-specific fields
   */
  private static hasNovelAIFields(obj: any): boolean {
    return (
      obj &&
      (obj.prompt !== undefined ||
        obj.v4_prompt !== undefined ||
        obj.uc !== undefined ||
        obj.scale !== undefined ||
        obj.noise_schedule !== undefined)
    );
  }

  /**
   * Convert NAI prompt syntax to ComfyUI-compatible format.
   * - Inline weight: `-0.8::feet::` → `(feet:-0.8)`
   * - Emphasis up: `{tag}` → `(tag:1.05)` per nesting level
   * - Emphasis down: `[tag]` → `(tag:0.95)` per nesting level
   */
  static convertNaiToComfyUI(prompt: string): string {
    if (!prompt) return prompt;

    // Step 1: Convert inline weight syntax value::tag::
    // Split comma-separated terms so each gets individual weight
    let result = prompt.replace(/(-?[\d.]+)::([^:]+)::/g, (_match, weight, content) => {
      const terms = content.split(',').map((t: string) => t.trim()).filter((t: string) => t);
      return terms.map((t: string) => `(${t}:${weight})`).join(', ');
    });

    // Step 2: Convert {} and [] brackets to (:weight)
    result = this.convertBrackets(result);

    // Step 3: Simplify nested single-content weights: ((text:w1):w2) → (text:w1*w2)
    result = this.simplifyNestedWeights(result);

    return result;
  }

  /**
   * Recursively convert NAI bracket syntax to ComfyUI weight syntax
   */
  private static convertBrackets(text: string): string {
    const NAI_FACTOR = 1.05;
    let result = '';
    let i = 0;

    while (i < text.length) {
      const ch = text[i];

      if (ch === '{' || ch === '[') {
        const openChar = ch;
        const closeChar = ch === '{' ? '}' : ']';
        const isPositive = ch === '{';

        // Find matching closing bracket
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
          if (text[j] === openChar) depth++;
          else if (text[j] === closeChar) depth--;
          j++;
        }

        if (depth === 0) {
          // Found matching bracket
          const inner = text.substring(i + 1, j - 1);
          const processed = this.convertBrackets(inner);
          const weight = isPositive ? NAI_FACTOR : (1 / NAI_FACTOR);
          result += `(${processed}:${weight.toFixed(2)})`;
          i = j;
        } else {
          // No matching bracket, output as-is
          result += ch;
          i++;
        }
      } else {
        result += ch;
        i++;
      }
    }

    return result;
  }

  /**
   * Simplify nested single-content weights: ((text:1.05):1.05) → (text:1.10)
   */
  private static simplifyNestedWeights(text: string): string {
    let result = text;
    let changed = true;
    while (changed) {
      changed = false;
      result = result.replace(
        /\(\(([^()]+):([\d.]+)\):([\d.]+)\)/g,
        (_match, content, innerW, outerW) => {
          changed = true;
          const combined = (parseFloat(innerW) * parseFloat(outerW)).toFixed(2);
          return `(${content}:${combined})`;
        }
      );
    }
    return result;
  }

  /**
   * Extract and normalize character prompts from NAI v4 structure
   * path: v4_prompt.caption.char_captions[].char_caption
   */
  private static extractCharacterPromptText(naiData: any): string | undefined {
    const rawCharCaptions = naiData?.v4_prompt?.caption?.char_captions;
    if (!Array.isArray(rawCharCaptions) || rawCharCaptions.length === 0) {
      return undefined;
    }

    const normalizedCaptions = rawCharCaptions
      .map((item: any) => {
        const rawCaption = typeof item === 'string'
          ? item
          : (typeof item?.char_caption === 'string' ? item.char_caption : '');

        const trimmed = rawCaption.trim();
        if (!trimmed) return null;

        return this.convertNaiToComfyUI(trimmed);
      })
      .filter((value: string | null): value is string => !!value && value.length > 0);

    if (normalizedCaptions.length === 0) {
      return undefined;
    }

    // 검색 최적화를 위해 하나의 텍스트로 평탄화
    return normalizedCaptions.join(', ');
  }

  /**
   * Parse NovelAI metadata
   */
  static parse(data: any): AIMetadata {
    try {
      let naiData: any;
      let topLevelData: any = data; // 원본 데이터 보존 (Source, Software 등)

      // Handle string input
      if (typeof data === 'string') {
        topLevelData = JSON.parse(data);
        // Check if Comment field exists (Stealth PNG format)
        if (topLevelData.Comment) {
          try {
            naiData = JSON.parse(topLevelData.Comment);
            console.log('📦 [NovelAIParser] Parsed Comment field from Stealth PNG');
          } catch (e) {
            console.warn('[NovelAIParser] Failed to parse Comment field:', e);
            naiData = topLevelData;
          }
        } else {
          naiData = topLevelData;
        }
      }
      // Handle Comment field (old NAI format) - already an object
      else if (data.Comment) {
        topLevelData = data;
        try {
          naiData = JSON.parse(data.Comment);
        } catch (e) {
          console.warn('[NovelAIParser] Failed to parse Comment field:', e);
          naiData = data;
        }
      }
      // Handle direct object
      else {
        naiData = data;
      }

      const aiInfo: AIMetadata = {};

      // Positive prompt (v4_prompt takes priority)
      // Convert NAI syntax to ComfyUI format for consistency and search
      if (naiData.v4_prompt?.caption?.base_caption) {
        const raw = naiData.v4_prompt.caption.base_caption;
        aiInfo.positive_prompt = this.convertNaiToComfyUI(raw);
        aiInfo.prompt = aiInfo.positive_prompt;
      } else if (naiData.prompt) {
        // Type guard: ensure prompt is a string
        if (typeof naiData.prompt === 'string') {
          aiInfo.positive_prompt = this.convertNaiToComfyUI(naiData.prompt);
          aiInfo.prompt = aiInfo.positive_prompt;
        } else if (typeof naiData.prompt === 'object' && naiData.prompt?.caption?.base_caption) {
          // Handle case where naiData.prompt is actually a v4_prompt structure
          const raw = naiData.prompt.caption.base_caption;
          aiInfo.positive_prompt = this.convertNaiToComfyUI(raw);
          aiInfo.prompt = aiInfo.positive_prompt;
        }
      }

      // Character prompt (v4_prompt.caption.char_captions)
      aiInfo.character_prompt_text = this.extractCharacterPromptText(naiData);

      // Negative prompt (v4_negative_prompt takes priority)
      if (naiData.v4_negative_prompt?.caption?.base_caption) {
        aiInfo.negative_prompt = this.convertNaiToComfyUI(naiData.v4_negative_prompt.caption.base_caption);
      } else if (naiData.uc) {
        // Type guard: ensure uc is a string
        if (typeof naiData.uc === 'string') {
          aiInfo.negative_prompt = this.convertNaiToComfyUI(naiData.uc);
        } else if (typeof naiData.uc === 'object' && naiData.uc?.caption?.base_caption) {
          // Handle case where naiData.uc is actually a v4_negative_prompt structure
          aiInfo.negative_prompt = this.convertNaiToComfyUI(naiData.uc.caption.base_caption);
        }
      }

      // Generation parameters
      if (naiData.steps) aiInfo.steps = naiData.steps;
      if (naiData.scale) aiInfo.cfg_scale = naiData.scale; // NAI uses 'scale'
      if (naiData.seed) aiInfo.seed = Number(naiData.seed);  // Convert to number
      if (naiData.sampler) aiInfo.sampler = naiData.sampler;
      if (naiData.noise_schedule) aiInfo.scheduler = naiData.noise_schedule;
      if (naiData.width) aiInfo.width = naiData.width;
      if (naiData.height) aiInfo.height = naiData.height;

      // NovelAI specific fields
      if (naiData.cfg_rescale !== undefined) aiInfo.cfg_rescale = naiData.cfg_rescale;
      if (naiData.uncond_scale !== undefined) aiInfo.uncond_scale = naiData.uncond_scale;
      if (naiData.v4_prompt?.use_order !== undefined) {
        aiInfo.use_order = naiData.v4_prompt.use_order;
      }

      // Additional NovelAI V4 parameters
      if (naiData.sm !== undefined) aiInfo.sm = naiData.sm;
      if (naiData.sm_dyn !== undefined) aiInfo.sm_dyn = naiData.sm_dyn;
      if (naiData.dynamic_thresholding !== undefined) aiInfo.dynamic_thresholding = naiData.dynamic_thresholding;
      if (naiData.controlnet_strength !== undefined) aiInfo.controlnet_strength = naiData.controlnet_strength;
      if (naiData.legacy !== undefined) aiInfo.legacy = naiData.legacy;
      if (naiData.add_original_image !== undefined) aiInfo.add_original_image = naiData.add_original_image;
      if (naiData.skip_cfg_above_sigma !== undefined) aiInfo.skip_cfg_above_sigma = naiData.skip_cfg_above_sigma;

      // Extract model from Source field (top-level data)
      if (topLevelData.Source) {
        const sourceMatch = topLevelData.Source.match(/NovelAI Diffusion (V[\d.]+)/i);
        if (sourceMatch) {
          aiInfo.model = `NovelAI Diffusion ${sourceMatch[1]}`;
        }
      }

      // Extract Software field (top-level data)
      if (topLevelData.Software) {
        aiInfo.software = topLevelData.Software;
      }

      // Extract Title/Description (top-level data) - as comment, not prompt
      if (topLevelData.Title) {
        aiInfo.title = topLevelData.Title;
      }
      if (topLevelData.Description) {
        aiInfo.description = topLevelData.Description;
      }

      // Mark as NovelAI
      aiInfo.ai_tool = 'NovelAI';

      // 원본 NAI 생성 파라미터 전체를 JSON으로 보존
      try {
        aiInfo.raw_nai_parameters = JSON.stringify(naiData);
      } catch (e) {
        console.warn('[NovelAIParser] Failed to serialize raw NAI parameters:', e);
      }

      console.log('✅ [NovelAIParser] Successfully parsed:', {
        hasPrompt: !!aiInfo.prompt,
        hasCharacterPrompt: !!aiInfo.character_prompt_text,
        hasNegativePrompt: !!aiInfo.negative_prompt,
        steps: aiInfo.steps,
        scale: aiInfo.cfg_scale,
        sampler: aiInfo.sampler,
        model: aiInfo.model
      });

      return aiInfo;
    } catch (error) {
      console.warn('NovelAI parsing error:', error);
      return {};
    }
  }
}
