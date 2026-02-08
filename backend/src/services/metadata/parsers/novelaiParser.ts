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
      if (naiData.v4_prompt?.caption?.base_caption) {
        aiInfo.positive_prompt = naiData.v4_prompt.caption.base_caption;
        aiInfo.prompt = aiInfo.positive_prompt;
      } else if (naiData.prompt) {
        // Type guard: ensure prompt is a string
        if (typeof naiData.prompt === 'string') {
          aiInfo.positive_prompt = naiData.prompt;
          aiInfo.prompt = naiData.prompt;
        } else if (typeof naiData.prompt === 'object' && naiData.prompt?.caption?.base_caption) {
          // Handle case where naiData.prompt is actually a v4_prompt structure
          aiInfo.positive_prompt = naiData.prompt.caption.base_caption;
          aiInfo.prompt = naiData.prompt.caption.base_caption;
        }
      }

      // Negative prompt (v4_negative_prompt takes priority)
      if (naiData.v4_negative_prompt?.caption?.base_caption) {
        aiInfo.negative_prompt = naiData.v4_negative_prompt.caption.base_caption;
      } else if (naiData.uc) {
        // Type guard: ensure uc is a string
        if (typeof naiData.uc === 'string') {
          aiInfo.negative_prompt = naiData.uc;
        } else if (typeof naiData.uc === 'object' && naiData.uc?.caption?.base_caption) {
          // Handle case where naiData.uc is actually a v4_negative_prompt structure
          aiInfo.negative_prompt = naiData.uc.caption.base_caption;
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
