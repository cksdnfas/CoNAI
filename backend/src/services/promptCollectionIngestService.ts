import { PromptCollectionModel } from '../models/PromptCollection';
import { PromptGroupModel } from '../models/PromptGroup';
import { removeLoRAWeight, tokenizePrompt, type PromptTerm } from '@conai/shared';

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

  private static cleanLoRAPrompts(loras: string[], groupId: number | undefined, logLabel: string) {
    const loraPrompts: Array<{ prompt: string; group_id?: number }> = [];
    for (const lora of loras) {
      try {
        const cleanedLoRA = removeLoRAWeight(lora);
        loraPrompts.push({ prompt: cleanedLoRA, group_id: groupId });
      } catch (loraError) {
        console.error(`❌ Failed to clean ${logLabel} LoRA "${lora}":`, loraError);
      }
    }
    return loraPrompts;
  }

  private static termPrompts(terms: PromptTerm[]): Array<{ prompt: string; group_id?: number }> {
    return terms.filter((term) => term.value.length >= 2).map((term) => ({ prompt: term.value }));
  }

  private static async collectPositiveLikePrompt(prompt: string, groupId?: number) {
    const { loras, terms } = tokenizePrompt(prompt);
    const loraPrompts = this.cleanLoRAPrompts(loras, groupId, 'positive');
    const termPrompts = this.termPrompts(terms);

    if (loraPrompts.length > 0) {
      await PromptCollectionModel.batchAddOrIncrement(loraPrompts);
    }
    if (termPrompts.length > 0) {
      await PromptCollectionModel.batchAddOrIncrement(termPrompts);
    }
  }

  private static async collectNegativePrompt(prompt: string, groupId?: number) {
    const { loras, terms } = tokenizePrompt(prompt);
    const loraPrompts = this.cleanLoRAPrompts(loras, groupId, 'negative');
    const termPrompts = this.termPrompts(terms);

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
        const termPrompts = this.termPrompts(tokenizePrompt(characterPromptText).terms);
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

  /** The same term set drives deletion and undo, including character prompts and automatic tags. */
  private static imageUsageTerms(prompt: string | null, negativePrompt: string | null, characterPromptText: string | null, autoTags: string | null) {
    const result: Array<{ prompt: string; type: 'positive' | 'negative' | 'auto' }> = [];
    for (const [text, type] of [[prompt, 'positive'], [characterPromptText, 'positive'], [negativePrompt, 'negative']] as const) {
      // Same filters as collection, so deletion and undo touch exactly the collected terms.
      if (!this.isValidPrompt(text)) continue;
      for (const term of this.termPrompts(tokenizePrompt(text).terms)) {
        result.push({ prompt: term.prompt, type });
      }
    }
    if (autoTags) {
      try {
        const parsed = JSON.parse(autoTags) as { tagger?: { caption?: string | null; taglist?: string | null } | null };
        const text = parsed?.tagger?.taglist || parsed?.tagger?.caption || '';
        for (const term of text.split(',').map((value) => value.trim()).filter(Boolean)) {
          result.push({ prompt: term, type: 'auto' });
        }
      } catch (error) {
        console.warn('Failed to parse auto tags during prompt usage adjustment:', error);
      }
    }
    return result;
  }

  static async removeFromImage(prompt: string | null, negativePrompt: string | null, characterPromptText: string | null = null, autoTags: string | null = null): Promise<void> {
    for (const term of this.imageUsageTerms(prompt, negativePrompt, characterPromptText, autoTags)) {
      PromptCollectionModel.decrementUsage(term.prompt, term.type);
    }
  }

  static restoreImageUsage(prompt: string | null, negativePrompt: string | null, characterPromptText: string | null = null, autoTags: string | null = null): void {
    for (const term of this.imageUsageTerms(prompt, negativePrompt, characterPromptText, autoTags)) {
      if (term.type === 'positive') PromptCollectionModel.addOrIncrement(term.prompt);
      else if (term.type === 'negative') PromptCollectionModel.addOrIncrementNegative(term.prompt);
      else PromptCollectionModel.addOrIncrementAuto(term.prompt);
    }
  }
}
