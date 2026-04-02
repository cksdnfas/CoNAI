import { PromptCollectionModel } from '../models/PromptCollection';
import { db } from '../database/init';
import { SynonymService } from './synonymService';
import { PromptGroupService } from './promptGroupService';
import { normalizeSearchTerm, PromptSearchResult, PromptStatistics } from '@conai/shared';

export class PromptCollectionQueryService {
  static async searchPrompts(
    query: string,
    type: 'positive' | 'negative' | 'auto' | 'both' = 'both',
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ prompts: PromptSearchResult[], total: number }> {
    try {
      const normalizedQuery = normalizeSearchTerm(query);

      if (type === 'both') {
        const [positiveResult, negativeResult] = await Promise.all([
          PromptCollectionModel.searchPrompts(normalizedQuery, page, limit, sortBy, sortOrder),
          PromptCollectionModel.searchNegativePrompts(normalizedQuery, page, limit, sortBy, sortOrder)
        ]);

        const allPrompts = [...positiveResult.prompts, ...negativeResult.prompts];
        allPrompts.sort((a, b) => {
          if (sortBy === 'usage_count') {
            return sortOrder === 'DESC' ? b.usage_count - a.usage_count : a.usage_count - b.usage_count;
          } else if (sortBy === 'prompt') {
            return sortOrder === 'DESC' ? b.prompt.localeCompare(a.prompt) : a.prompt.localeCompare(b.prompt);
          }
          return 0;
        });

        const offset = (page - 1) * limit;
        const paginatedPrompts = allPrompts.slice(offset, offset + limit);

        return {
          prompts: paginatedPrompts,
          total: positiveResult.total + negativeResult.total
        };
      }

      if (type === 'positive') {
        return await PromptCollectionModel.searchPrompts(normalizedQuery, page, limit, sortBy, sortOrder);
      }
      if (type === 'auto') {
        return await PromptCollectionModel.searchAutoPrompts(normalizedQuery, page, limit, sortBy, sortOrder);
      }
      return await PromptCollectionModel.searchNegativePrompts(normalizedQuery, page, limit, sortBy, sortOrder);
    } catch (error) {
      console.error('Error searching prompts:', error);
      throw error;
    }
  }

  static async searchInSynonymGroup(searchTerm: string, type: 'positive' | 'negative' | 'auto' = 'positive'): Promise<PromptSearchResult | null> {
    try {
      const result = await SynonymService.findInSynonymGroup(searchTerm, type);
      if (!result) {
        return null;
      }

      return {
        id: result.id,
        prompt: result.prompt,
        usage_count: result.usage_count,
        group_id: result.group_id,
        synonyms: result.synonyms ? JSON.parse(result.synonyms) : [],
        type
      };
    } catch (error) {
      console.error('Error searching in synonym group:', error);
      throw error;
    }
  }

  static async getStatistics(): Promise<PromptStatistics> {
    try {
      const [mostUsedPrompts] = await Promise.all([
        PromptCollectionModel.getMostUsedPrompts(10)
      ]);

      const totalStats = {
        total_prompts: (db.prepare('SELECT COUNT(*) as count FROM prompt_collection').get() as { count: number }).count,
        total_negative_prompts: (db.prepare('SELECT COUNT(*) as count FROM negative_prompt_collection').get() as { count: number }).count,
        total_auto_prompts: (db.prepare('SELECT COUNT(*) as count FROM auto_prompt_collection').get() as { count: number }).count,
      };

      const recentPrompts = await this.searchPrompts('', 'both', 1, 10, 'created_at', 'DESC');

      return {
        total_prompts: totalStats.total_prompts,
        total_negative_prompts: totalStats.total_negative_prompts,
        total_auto_prompts: totalStats.total_auto_prompts,
        most_used_prompts: mostUsedPrompts,
        recent_prompts: recentPrompts.prompts
      };
    } catch (error) {
      console.error('Error getting statistics:', error);
      throw error;
    }
  }

  static async getGroupPrompts(groupId: number, type: 'positive' | 'negative' | 'auto' = 'positive'): Promise<PromptSearchResult[]> {
    try {
      const prompts = await SynonymService.getGroupPrompts(groupId, type);
      return prompts.map(prompt => ({
        id: prompt.id,
        prompt: prompt.prompt,
        usage_count: prompt.usage_count,
        group_id: prompt.group_id,
        synonyms: prompt.synonyms ? JSON.parse(prompt.synonyms) : [],
        type
      }));
    } catch (error) {
      console.error('Error getting group prompts:', error);
      throw error;
    }
  }

  static async getTopPrompts(limit: number = 20, type: 'positive' | 'negative' | 'auto' | 'both' = 'both'): Promise<PromptSearchResult[]> {
    try {
      if (type === 'positive') {
        return await PromptCollectionModel.getMostUsedPrompts(limit);
      }
      if (type === 'negative') {
        const result = await PromptCollectionModel.searchNegativePrompts('', 1, limit, 'usage_count', 'DESC');
        return result.prompts;
      }
      if (type === 'auto') {
        const result = await PromptCollectionModel.searchAutoPrompts('', 1, limit, 'usage_count', 'DESC');
        return result.prompts;
      }

      const [positive, negative] = await Promise.all([
        PromptCollectionModel.getMostUsedPrompts(limit),
        PromptCollectionModel.searchNegativePrompts('', 1, limit, 'usage_count', 'DESC')
      ]);

      return [...positive, ...negative.prompts]
        .sort((a, b) => b.usage_count - a.usage_count)
        .slice(0, limit);
    } catch (error) {
      console.error('Error getting top prompts:', error);
      throw error;
    }
  }

  static async searchPromptsWithGroups(
    query: string,
    type: 'positive' | 'negative' | 'auto' | 'both' = 'both',
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    groupId?: number | null
  ): Promise<{ prompts: any[], total: number, group_info?: any }> {
    try {
      const normalizedQuery = normalizeSearchTerm(query);
      let result;
      let groupInfo: any = null;

      if (groupId !== undefined) {
        // @ts-ignore
        result = await PromptGroupService.getPromptsInGroup(
          groupId,
          type as 'positive' | 'negative' | 'auto',
          page,
          limit,
          normalizedQuery,
          sortBy,
          sortOrder,
        );

        if (groupId !== null) {
          // @ts-ignore
          groupInfo = await PromptGroupService.getGroupById(groupId, type as 'positive' | 'negative' | 'auto');
        } else {
          groupInfo = { id: 0, group_name: 'Unclassified' };
        }

        const enrichedPrompts = result.prompts.map((prompt: any) => ({
          ...prompt,
          group_info: groupInfo,
        }));

        return { prompts: enrichedPrompts, total: result.total, group_info: groupInfo };
      }

      result = await this.searchPrompts(normalizedQuery, type, page, limit, sortBy, sortOrder);

      const enrichedPrompts = await Promise.all(
        result.prompts.map(async (prompt) => ({
          ...prompt,
          group_info: await PromptGroupService.getGroupById(prompt.group_id, prompt.type)
        }))
      );

      return { prompts: enrichedPrompts, total: result.total };
    } catch (error) {
      console.error('Error searching prompts with groups:', error);
      throw error;
    }
  }

  static async getGroupStatistics(type: 'positive' | 'negative' | 'auto' = 'positive'): Promise<any[]> {
    try {
      // @ts-ignore
      return await PromptGroupService.getAllGroups(false, type);
    } catch (error) {
      console.error('Error getting group statistics:', error);
      throw error;
    }
  }

  static async resolvePromptsWithGroups(
    prompts: string[],
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<Array<{ query: string; matched_prompt: string | null; group_info: any | null }>> {
    try {
      const uniquePromptMap = new Map<string, string>();

      for (const prompt of prompts) {
        const normalizedPrompt = normalizeSearchTerm(String(prompt ?? '')).trim();
        if (!normalizedPrompt) {
          continue;
        }

        const lookupKey = normalizedPrompt.toLowerCase();
        if (!uniquePromptMap.has(lookupKey)) {
          uniquePromptMap.set(lookupKey, normalizedPrompt);
        }
      }

      const groups = await PromptGroupService.getAllGroups(true, type);
      const groupsById = new Map(groups.map((group) => [group.id, group] as const));

      const getGroupPath = (groupId: number | null | undefined) => {
        if (groupId === null || groupId === undefined || groupId === 0) {
          return ['Unclassified'];
        }

        const visited = new Set<number>();
        const path: string[] = [];
        let currentId: number | null | undefined = groupId;

        while (currentId !== null && currentId !== undefined && currentId !== 0 && !visited.has(currentId)) {
          visited.add(currentId);
          const currentGroup = groupsById.get(currentId);
          if (!currentGroup) {
            break;
          }

          path.unshift(currentGroup.group_name);
          currentId = currentGroup.parent_id;
        }

        return path.length > 0 ? path : ['Unclassified'];
      };

      return Promise.all(
        [...uniquePromptMap.values()].map(async (prompt) => {
          const matchedPrompt = await SynonymService.findInSynonymGroup(prompt, type);
          const groupInfo = matchedPrompt
            ? await PromptGroupService.getGroupById(matchedPrompt.group_id ?? null, type)
            : null;
          const groupPath = matchedPrompt ? getGroupPath(matchedPrompt.group_id ?? null) : null;

          return {
            query: prompt,
            matched_prompt: matchedPrompt?.prompt ?? null,
            group_info: groupInfo && groupPath ? { ...groupInfo, group_path: groupPath } : groupInfo,
          };
        }),
      );
    } catch (error) {
      console.error('Error resolving prompts with groups:', error);
      throw error;
    }
  }
}
