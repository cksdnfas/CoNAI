import { PromptSearchResult, PromptStatistics } from '@conai/shared';
import { PromptCollectionIngestService } from './promptCollectionIngestService';
import { PromptCollectionMutationService } from './promptCollectionMutationService';
import { PromptCollectionQueryService } from './promptCollectionQueryService';

export class PromptCollectionService {
  static async collectFromImage(prompt: string | null, negativePrompt: string | null, characterPromptText: string | null = null): Promise<void> {
    return PromptCollectionIngestService.collectFromImage(prompt, negativePrompt, characterPromptText);
  }

  static async searchPrompts(
    query: string,
    type: 'positive' | 'negative' | 'auto' | 'both' = 'both',
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ prompts: PromptSearchResult[], total: number }> {
    return PromptCollectionQueryService.searchPrompts(query, type, page, limit, sortBy, sortOrder);
  }

  static async searchInSynonymGroup(searchTerm: string, type: 'positive' | 'negative' | 'auto' = 'positive') {
    return PromptCollectionQueryService.searchInSynonymGroup(searchTerm, type);
  }

  static async batchAddOrIncrementAuto(prompts: Array<{ prompt: string; group_id?: number }>): Promise<number> {
    return PromptCollectionIngestService.batchAddOrIncrementAuto(prompts);
  }

  static async getStatistics(): Promise<PromptStatistics> {
    return PromptCollectionQueryService.getStatistics();
  }

  static async setSynonyms(mainPrompt: string, synonyms: string[], type: 'positive' | 'negative' | 'auto' = 'positive') {
    return PromptCollectionMutationService.setSynonyms(mainPrompt, synonyms, type);
  }

  static async removeSynonym(mainPromptId: number, synonymToRemove: string, type: 'positive' | 'negative' | 'auto' = 'positive') {
    return PromptCollectionMutationService.removeSynonym(mainPromptId, synonymToRemove, type);
  }

  static async getGroupPrompts(groupId: number, type: 'positive' | 'negative' | 'auto' = 'positive') {
    return PromptCollectionQueryService.getGroupPrompts(groupId, type);
  }

  static async setGroupId(promptId: number, groupId: number | null, type: 'positive' | 'negative' | 'auto' = 'positive') {
    return PromptCollectionMutationService.setGroupId(promptId, groupId, type);
  }

  static async deletePrompt(id: number, type: 'positive' | 'negative' | 'auto' = 'positive'): Promise<boolean> {
    return PromptCollectionMutationService.deletePrompt(id, type);
  }

  static async removeFromImage(prompt: string | null, negativePrompt: string | null): Promise<void> {
    return PromptCollectionIngestService.removeFromImage(prompt, negativePrompt);
  }

  static async getTopPrompts(limit: number = 20, type: 'positive' | 'negative' | 'auto' | 'both' = 'both') {
    return PromptCollectionQueryService.getTopPrompts(limit, type);
  }

  static async searchPromptsWithGroups(
    query: string,
    type: 'positive' | 'negative' | 'auto' | 'both' = 'both',
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    groupId?: number | null
  ) {
    return PromptCollectionQueryService.searchPromptsWithGroups(query, type, page, limit, sortBy, sortOrder, groupId);
  }

  static async assignPromptToGroup(promptId: number, groupId: number | null, type: 'positive' | 'negative' | 'auto' = 'positive'): Promise<boolean> {
    return PromptCollectionMutationService.assignPromptToGroup(promptId, groupId, type);
  }

  static async getGroupStatistics(type: 'positive' | 'negative' | 'auto' = 'positive') {
    return PromptCollectionQueryService.getGroupStatistics(type);
  }

  static async batchAssignPromptsToGroup(
    prompts: string[],
    groupId: number | null,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<{ created: number; updated: number; failed: string[] }> {
    return PromptCollectionMutationService.batchAssignPromptsToGroup(prompts, groupId, type);
  }
}
