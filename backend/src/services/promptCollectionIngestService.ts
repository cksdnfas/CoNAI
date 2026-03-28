import { PromptCollectionModel } from '../models/PromptCollection';
import { PromptGroupModel } from '../models/PromptGroup';
import { isLoRAModel, cleanPromptTerm, parsePromptWithLoRAs, removeLoRAWeight } from '@conai/shared';

export class PromptCollectionIngestService {
  /**
   * Invalid prompt values that should not be collected
   */
  private static readonly INVALID_PROMPTS = [
    'No prompt information available',
    'Metadata extraction failed',
    'Unknown',
    'Unknown AI Model',
    'No prompt',
    ''
  ];

  /**
   * LoRA 그룹 ID 캐시 (성능 최적화)
   */
  private static loraGroupCache: {
    positiveGroupId: number | null;
    negativeGroupId: number | null;
  } = {
    positiveGroupId: null,
    negativeGroupId: null
  };

  private static isValidPrompt(prompt: string | null | undefined): boolean {
    if (!prompt || typeof prompt !== 'string') {
      return false;
    }

    const trimmed = prompt.trim();

    if (this.INVALID_PROMPTS.includes(trimmed)) {
      return false;
    }

    if (trimmed.length < 2) {
      return false;
    }

    return true;
  }

  private static async ensureLoRAGroup(): Promise<{ positiveGroupId: number; negativeGroupId: number }> {
    if (this.loraGroupCache.positiveGroupId !== null && this.loraGroupCache.negativeGroupId !== null) {
      return {
        positiveGroupId: this.loraGroupCache.positiveGroupId,
        negativeGroupId: this.loraGroupCache.negativeGroupId,
      };
    }

    let positiveGroupId: number;
    let negativeGroupId: number;

    let positiveGroup = await PromptGroupModel.findByName('LoRA', 'positive');
    if (!positiveGroup) {
      console.log('📁 Creating LoRA group for positive prompts...');
      positiveGroupId = await PromptGroupModel.create({ group_name: 'LoRA', display_order: 999, is_visible: true }, 'positive');
    } else {
      positiveGroupId = positiveGroup.id;
    }

    let negativeGroup = await PromptGroupModel.findByName('LoRA', 'negative');
    if (!negativeGroup) {
      console.log('📁 Creating LoRA group for negative prompts...');
      negativeGroupId = await PromptGroupModel.create({ group_name: 'LoRA', display_order: 999, is_visible: true }, 'negative');
    } else {
      negativeGroupId = negativeGroup.id;
    }

    this.loraGroupCache.positiveGroupId = positiveGroupId;
    this.loraGroupCache.negativeGroupId = negativeGroupId;

    return { positiveGroupId, negativeGroupId };
  }

  private static async collectPositiveLikePrompt(prompt: string, groupId?: number) {
    const { loras, terms } = parsePromptWithLoRAs(prompt);
    const loraPrompts: Array<{ prompt: string; group_id?: number }> = [];
    const termPrompts: Array<{ prompt: string; group_id?: number }> = [];

    for (const lora of loras) {
      try {
        const cleanedLoRA = removeLoRAWeight(lora);
        loraPrompts.push({ prompt: cleanedLoRA, group_id: groupId });
      } catch (loraError) {
        console.error(`❌ Failed to clean LoRA "${lora}":`, loraError);
      }
    }

    for (const term of terms) {
      const trimmed = term.trim();
      if (!trimmed || trimmed.length < 2) continue;
      try {
        const cleaned = cleanPromptTerm(trimmed);
        if (cleaned && cleaned.length >= 2) {
          termPrompts.push({ prompt: cleaned });
        }
      } catch (termError) {
        console.error(`❌ Failed to clean term "${trimmed}":`, termError);
      }
    }

    if (loraPrompts.length > 0) {
      await PromptCollectionModel.batchAddOrIncrement(loraPrompts);
    }
    if (termPrompts.length > 0) {
      await PromptCollectionModel.batchAddOrIncrement(termPrompts);
    }
  }

  private static async collectNegativePrompt(prompt: string, groupId?: number) {
    const { loras, terms } = parsePromptWithLoRAs(prompt);
    const loraPrompts: Array<{ prompt: string; group_id?: number }> = [];
    const termPrompts: Array<{ prompt: string; group_id?: number }> = [];

    for (const lora of loras) {
      try {
        const cleanedLoRA = removeLoRAWeight(lora);
        loraPrompts.push({ prompt: cleanedLoRA, group_id: groupId });
      } catch (loraError) {
        console.error(`❌ Failed to clean negative LoRA "${lora}":`, loraError);
      }
    }

    for (const term of terms) {
      const trimmed = term.trim();
      if (!trimmed || trimmed.length < 2) continue;
      try {
        const cleaned = cleanPromptTerm(trimmed);
        if (cleaned && cleaned.length >= 2) {
          termPrompts.push({ prompt: cleaned });
        }
      } catch (termError) {
        console.error(`❌ Failed to clean negative term "${trimmed}":`, termError);
      }
    }

    if (loraPrompts.length > 0) {
      await PromptCollectionModel.batchAddOrIncrementNegative(loraPrompts);
    }
    if (termPrompts.length > 0) {
      await PromptCollectionModel.batchAddOrIncrementNegative(termPrompts);
    }
  }

  static async collectFromImage(prompt: string | null, negativePrompt: string | null, characterPromptText: string | null = null): Promise<void> {
    const startTime = Date.now();
    console.log('⏱️ [PromptCollection] Starting prompt collection...');

    try {
      const loraGroups = await this.ensureLoRAGroup();

      if (this.isValidPrompt(prompt)) {
        await this.collectPositiveLikePrompt(prompt!, loraGroups.positiveGroupId);
      } else if (prompt) {
        console.log(`⚠️ Skipping invalid prompt: "${prompt}"`);
      }

      if (this.isValidPrompt(characterPromptText)) {
        const { terms } = parsePromptWithLoRAs(characterPromptText!);
        const termPrompts: Array<{ prompt: string; group_id?: number }> = [];
        for (const term of terms) {
          const trimmed = term.trim();
          if (!trimmed || trimmed.length < 2) continue;
          try {
            const cleaned = cleanPromptTerm(trimmed);
            if (cleaned && cleaned.length >= 2) {
              termPrompts.push({ prompt: cleaned });
            }
          } catch (termError) {
            console.error(`❌ Failed to clean character term "${trimmed}":`, termError);
          }
        }
        if (termPrompts.length > 0) {
          await PromptCollectionModel.batchAddOrIncrement(termPrompts);
        }
      } else if (characterPromptText) {
        console.log(`⚠️ Skipping invalid character prompt: "${characterPromptText}"`);
      }

      if (this.isValidPrompt(negativePrompt)) {
        await this.collectNegativePrompt(negativePrompt!, loraGroups.negativeGroupId);
      } else if (negativePrompt) {
        console.log(`⚠️ Skipping invalid negative prompt: "${negativePrompt}"`);
      }

      console.log(`⏱️ [PromptCollection] ✅ Total collection time: ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error(`⏱️ [PromptCollection] ❌ Failed after ${Date.now() - startTime}ms:`, error);
      throw error;
    }
  }

  static async batchAddOrIncrementAuto(prompts: Array<{ prompt: string; group_id?: number }>): Promise<number> {
    try {
      return await PromptCollectionModel.batchAddOrIncrementAuto(prompts);
    } catch (error) {
      console.error('Error batch adding auto prompts:', error);
      throw error;
    }
  }

  static async removeFromImage(prompt: string | null, negativePrompt: string | null): Promise<void> {
    try {
      if (prompt) {
        const { terms } = parsePromptWithLoRAs(prompt);
        for (const term of terms) {
          const cleaned = term.trim();
          if (cleaned) {
            await PromptCollectionModel.decrementUsage(cleaned, 'positive');
          }
        }
      }

      if (negativePrompt) {
        const { terms } = parsePromptWithLoRAs(negativePrompt);
        for (const term of terms) {
          const cleaned = term.trim();
          if (cleaned) {
            await PromptCollectionModel.decrementUsage(cleaned, 'negative');
          }
        }
      }
    } catch (error) {
      console.error('Error removing prompts from image:', error);
      throw error;
    }
  }
}
