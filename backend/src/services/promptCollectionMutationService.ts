import { PromptCollectionModel } from '../models/PromptCollection';
import { PromptGroupService } from './promptGroupService';
import { SynonymService } from './synonymService';
import { isProtectedLoRAGroup } from './promptCollectionProtection';
import { PromptGroupModel } from '../models/PromptGroup';
import { db } from '../database/init';

export class PromptCollectionMutationError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 409) { super(message); }
}

export class PromptCollectionMutationService {
  static async setSynonyms(mainPrompt: string, synonyms: string[], type: 'positive' | 'negative' | 'auto' = 'positive') {
    try {
      return await SynonymService.setSynonymsAndMerge(mainPrompt, synonyms, type);
    } catch (error) {
      console.error('Error setting synonyms:', error);
      throw error;
    }
  }

  static async removeSynonym(mainPromptId: number, synonymToRemove: string, type: 'positive' | 'negative' | 'auto' = 'positive') {
    try {
      return await SynonymService.removeSynonym(mainPromptId, synonymToRemove, type);
    } catch (error) {
      console.error('Error removing synonym:', error);
      throw error;
    }
  }

  static async setGroupId(promptId: number, groupId: number | null, type: 'positive' | 'negative' | 'auto' = 'positive') {
    try {
      const prompt = await PromptCollectionModel.findById(promptId, type);
      if (prompt?.group_id && PromptGroupService.isDanbooruManagedGroupId(prompt.group_id, type)) {
        throw new Error('Danbooru auto-group prompts are managed automatically');
      }
      if (groupId !== null && PromptGroupService.isDanbooruManagedGroupId(groupId, type)) {
        throw new Error('Danbooru auto-groups are managed automatically');
      }
      return await PromptCollectionModel.setGroupId(promptId, groupId, type);
    } catch (error) {
      console.error('Error setting group ID:', error);
      throw error;
    }
  }

  static async deletePrompt(id: number, type: 'positive' | 'negative' | 'auto' = 'positive'): Promise<boolean> {
    return this.deletePromptInTransaction(id, type);
  }

  /** Synchronous domain validation is shared by single deletes and the atomic bulk transaction. */
  private static deletePromptInTransaction(id: number, type: 'positive' | 'negative' | 'auto'): boolean {
    try {
      if (!Number.isSafeInteger(id) || id <= 0) throw new PromptCollectionMutationError('Invalid prompt ID', 400);
      if (!['positive', 'negative', 'auto'].includes(type)) throw new PromptCollectionMutationError('Invalid prompt type', 400);
      const prompt = PromptCollectionModel.findById(id, type);
      if (prompt?.group_id) {
        const group = PromptGroupModel.findById(prompt.group_id, type);
        if (isProtectedLoRAGroup(group)) {
          throw new PromptCollectionMutationError('LoRA prompts are protected');
        }
        if (PromptGroupService.isDanbooruManagedGroupId(prompt.group_id, type)) {
          throw new PromptCollectionMutationError('Danbooru auto-group prompts are managed automatically');
        }
      }
      if (prompt?.usage_count > 0) throw new PromptCollectionMutationError('Prompts with remaining usage cannot be deleted');

      return PromptCollectionModel.delete(id, type);
    } catch (error) {
      console.error('Error deleting prompt:', error);
      throw error;
    }
  }

  static deletePrompts(ids: number[], type: 'positive' | 'negative' | 'auto' = 'positive'): number[] {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000) throw new PromptCollectionMutationError('Invalid prompt IDs: select 1–1000 prompts', 400);
    return db.transaction(() => [...new Set(ids)].filter((id) => this.deletePromptInTransaction(id, type)))();
  }

  static async assignPromptToGroup(promptId: number, groupId: number | null, type: 'positive' | 'negative' | 'auto' = 'positive'): Promise<boolean> {
    try {
      const prompt = await PromptCollectionModel.findById(promptId, type);
      if (prompt?.group_id) {
        const currentGroup = await PromptGroupService.getGroupById(prompt.group_id, type);
        if (isProtectedLoRAGroup(currentGroup)) {
          throw new Error('LoRA prompts are protected');
        }
        if (PromptGroupService.isDanbooruManagedGroupId(prompt.group_id, type)) {
          throw new Error('Danbooru auto-group prompts are managed automatically');
        }
      }

      if (groupId !== null) {
        const targetGroup = await PromptGroupService.getGroupById(groupId, type);
        if (isProtectedLoRAGroup(targetGroup)) {
          throw new Error('LoRA group is protected');
        }
        if (PromptGroupService.isDanbooruManagedGroupId(groupId, type)) {
          throw new Error('Danbooru auto-groups are managed automatically');
        }
      }

      return await PromptCollectionModel.setGroupId(promptId, groupId, type);
    } catch (error) {
      console.error('Error assigning prompt to group:', error);
      throw error;
    }
  }

  static async batchAssignPromptsToGroup(
    prompts: string[],
    groupId: number | null,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<{ created: number; updated: number; failed: string[] }> {
    try {
      let created = 0;
      let updated = 0;
      const failed: string[] = [];

      let addMethod;
      let tableName;

      if (type === 'positive') {
        addMethod = PromptCollectionModel.addOrIncrement.bind(PromptCollectionModel);
        tableName = 'prompt_collection';
      } else if (type === 'auto') {
        addMethod = PromptCollectionModel.addOrIncrementAuto.bind(PromptCollectionModel);
        tableName = 'auto_prompt_collection';
      } else {
        addMethod = PromptCollectionModel.addOrIncrementNegative.bind(PromptCollectionModel);
        tableName = 'negative_prompt_collection';
      }

      if (groupId !== null) {
        const targetGroup = await PromptGroupService.getGroupById(groupId, type);
        if (isProtectedLoRAGroup(targetGroup)) {
          throw new Error('LoRA group is protected');
        }
        if (PromptGroupService.isDanbooruManagedGroupId(groupId, type)) {
          throw new Error('Danbooru auto-groups are managed automatically');
        }
      }

      for (const promptText of prompts) {
        const trimmedPrompt = promptText.trim();
        if (!trimmedPrompt) continue;

        try {
          const { db } = require('../database/init');
          const existing = db.prepare(`SELECT id, group_id FROM ${tableName} WHERE prompt = ?`).get(trimmedPrompt) as any;

          if (existing) {
            if (existing.group_id) {
              const currentGroup = await PromptGroupService.getGroupById(existing.group_id, type);
              if (isProtectedLoRAGroup(currentGroup) || PromptGroupService.isDanbooruManagedGroupId(existing.group_id, type)) {
                failed.push(trimmedPrompt);
                continue;
              }
            }

            const success = await PromptCollectionModel.setGroupId(existing.id, groupId, type);
            if (success) {
              updated++;
            } else {
              failed.push(trimmedPrompt);
            }
          } else {
            await addMethod(trimmedPrompt, groupId || undefined);
            created++;
          }
        } catch (error) {
          console.error(`Error assigning prompt "${trimmedPrompt}":`, error);
          failed.push(trimmedPrompt);
        }
      }

      return { created, updated, failed };
    } catch (error) {
      console.error('Error batch assigning prompts:', error);
      throw error;
    }
  }
}
