/**
 * Prompt API
 *
 * Prompt collection and group management:
 * - Prompt collection CRUD
 * - Prompt group CRUD
 * - Search and filtering
 * - Synonym management
 * - Statistics and top prompts
 */

import apiClient from './apiClient';
import type {
  PromptCollectionResponse,
  PromptGroupRecord,
  PromptGroupData,
  PromptGroupWithPrompts,
  PromptGroupResponse,
} from '@comfyui-image-manager/shared';

/**
 * Prompt Collection API
 */
export const promptCollectionApi = {
  /**
   * Search prompts
   */
  searchPrompts: async (
    query: string = '',
    type: 'positive' | 'negative' | 'both' = 'both',
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    groupId?: number | null
  ): Promise<PromptCollectionResponse & { pagination?: any; group_info?: any }> => {
    let url = `/api/prompt-collection/search?q=${encodeURIComponent(query)}&type=${type}&page=${page}&limit=${limit}&sortBy=${sortBy}&sortOrder=${sortOrder}`;
    if (groupId !== undefined) {
      url += `&group_id=${groupId}`;
    }
    const response = await apiClient.get(url);
    return response.data;
  },

  /**
   * Delete prompt
   */
  deletePrompt: async (
    promptId: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptCollectionResponse> => {
    const response = await apiClient.delete(`/api/prompt-collection/${promptId}?type=${type}`);
    return response.data;
  },

  /**
   * Assign prompt to group
   */
  assignPromptToGroup: async (
    promptId: number,
    groupId: number | null,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptCollectionResponse> => {
    const response = await apiClient.put('/api/prompt-collection/assign-group', {
      prompt_id: promptId,
      group_id: groupId,
      type,
    });
    return response.data;
  },

  /**
   * Batch assign prompts to group
   */
  batchAssignPromptsToGroup: async (
    prompts: string[],
    groupId: number | null,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<
    PromptCollectionResponse & { created?: number; updated?: number; failed?: string[] }
  > => {
    const response = await apiClient.post('/api/prompt-collection/batch-assign', {
      prompts,
      group_id: groupId,
      type,
    });
    return response.data;
  },

  /**
   * Get prompt statistics
   */
  getStatistics: async (): Promise<PromptCollectionResponse> => {
    const response = await apiClient.get('/api/prompt-collection/statistics');
    return response.data;
  },

  /**
   * Get top prompts
   */
  getTopPrompts: async (
    limit: number = 20,
    type: 'positive' | 'negative' | 'both' = 'both'
  ): Promise<PromptCollectionResponse> => {
    const response = await apiClient.get(
      `/api/prompt-collection/top?limit=${limit}&type=${type}`
    );
    return response.data;
  },

  /**
   * Set synonyms for prompt
   */
  setSynonyms: async (
    mainPrompt: string,
    synonyms: string[],
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptCollectionResponse> => {
    const response = await apiClient.post('/api/prompt-collection/synonyms', {
      mainPrompt,
      synonyms,
      type,
    });
    return response.data;
  },

  /**
   * Remove synonym
   */
  removeSynonym: async (
    promptId: number,
    synonym: string,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptCollectionResponse> => {
    const response = await apiClient.delete(`/api/prompt-collection/synonyms/${promptId}`, {
      data: { synonym, type },
    });
    return response.data;
  },
};

/**
 * Prompt Group API
 */
export const promptGroupApi = {
  /**
   * Get all prompt groups
   */
  getGroups: async (
    includeHidden: boolean = false,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<{ success: boolean; data?: PromptGroupWithPrompts[]; error?: string }> => {
    const response = await apiClient.get(
      `/api/prompt-groups?include_hidden=${includeHidden}&type=${type}`
    );
    return response.data;
  },

  /**
   * Get specific prompt group
   */
  getGroup: async (
    id: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<{ success: boolean; data?: PromptGroupRecord; error?: string }> => {
    const response = await apiClient.get(`/api/prompt-groups/${id}?type=${type}`);
    return response.data;
  },

  /**
   * Get prompts in group
   */
  getGroupPrompts: async (
    id: number,
    type: 'positive' | 'negative' = 'positive',
    page: number = 1,
    limit: number = 20
  ): Promise<PromptGroupResponse> => {
    const response = await apiClient.get(
      `/api/prompt-groups/${id}/prompts?type=${type}&page=${page}&limit=${limit}`
    );
    return response.data;
  },

  /**
   * Create new prompt group
   */
  createGroup: async (
    groupData: PromptGroupData,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupResponse> => {
    const response = await apiClient.post(`/api/prompt-groups?type=${type}`, groupData);
    return response.data;
  },

  /**
   * Update prompt group
   */
  updateGroup: async (
    id: number,
    groupData: PromptGroupData,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupResponse> => {
    const response = await apiClient.put(`/api/prompt-groups/${id}`, { ...groupData, type });
    return response.data;
  },

  /**
   * Delete prompt group
   */
  deleteGroup: async (
    id: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupResponse> => {
    const response = await apiClient.delete(`/api/prompt-groups/${id}?type=${type}`);
    return response.data;
  },

  /**
   * Move prompt to different group
   */
  movePromptToGroup: async (
    promptId: number,
    targetGroupId: number | null,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupResponse> => {
    const response = await apiClient.put('/api/prompt-groups/move-prompt', {
      prompt_id: promptId,
      target_group_id: targetGroupId,
      type,
    });
    return response.data;
  },

  /**
   * Update group display order
   */
  updateGroupOrders: async (
    groupOrders: { id: number; display_order: number }[],
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupResponse> => {
    const response = await apiClient.put('/api/prompt-groups/reorder', {
      group_orders: groupOrders,
      type,
    });
    return response.data;
  },
};
