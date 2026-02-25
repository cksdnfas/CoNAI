import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { promptCollectionApi, promptGroupApi } from '../services/api/promptApi';
import { cacheControl } from '../services/api/apiClient';
import type { PromptSearchResult } from '@comfyui-image-manager/shared';

// Query keys
export const promptKeys = {
    all: ['prompts'] as const,
    groups: (type: string) => [...promptKeys.all, 'groups', type] as const,
    groupPrompts: (groupId: number | null, type: string) => [...promptKeys.all, 'group', groupId, type] as const,
    search: (query: string, type: string) => [...promptKeys.all, 'search', query, type] as const,
};

type PromptType = 'positive' | 'negative' | 'auto';

// --- Queries ---

export function usePromptGroups(type: PromptType) {
    return useQuery({
        queryKey: promptKeys.groups(type),
        queryFn: async () => {
            const response = await promptGroupApi.getGroups(false, type);
            if (!response || !response.data) {
                throw new Error('Failed to fetch prompt groups');
            }
            return response.data;
        },
        staleTime: 0, // Always fetch fresh data
    });
}

export function useGroupPrompts(groupId: number | null, type: PromptType, enabled: boolean = true) {
    return useQuery({
        queryKey: promptKeys.groupPrompts(groupId, type),
        queryFn: async () => {
            // groupId가 null이면 전체 조회? 아니면 API에 따라 다름. 
            // PromptExplorer 로직상 null이면 loadPrompts(null) 호출 -> fallback search('')
            // 하지만 여기서는 명시적으로 구분
            if (groupId === null) {
                // Fallback to searching all if groupId is null (Global view)
                // api/prompt-collection/search?q=&...
                const res = await promptCollectionApi.searchPrompts('', type, 1, 1000);
                const data = (res as any).data;
                return Array.isArray(data) ? data : ((res as any).prompts || []) as PromptSearchResult[];
            }

            const response = await promptGroupApi.getGroupPrompts(groupId, type, 1, 1000);
            if (response.success && response.data) {
                const data = response.data as any;
                return (Array.isArray(data) ? data : (data.prompts || [])) as PromptSearchResult[];
            }
            throw new Error('Failed to fetch group prompts');
        },
        enabled: enabled,
        staleTime: 0, // Always fetch fresh data
    });
}

export function useSearchPrompts(query: string, type: PromptType, enabled: boolean = false) {
    return useQuery({
        queryKey: promptKeys.search(query, type),
        queryFn: async () => {
            if (!query) return [];
            const res = await promptCollectionApi.searchPrompts(query, type, 1, 1000);
            const data = (res as any).data;
            return (Array.isArray(data) ? data : ((res as any).prompts || [])) as PromptSearchResult[];
        },
        enabled: enabled && !!query,
        staleTime: 0, // Always fetch fresh data
    });
}

// --- Mutations ---

export function useCreatePromptGroup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (vars: { name: string; parentId: number | null; type: PromptType }) => {
            const groupData: any = {
                group_name: vars.name,
                display_order: 0,
                is_visible: true,
                parent_id: vars.parentId
            };
            const response = await promptGroupApi.createGroup(groupData, vars.type);
            return response;
        },
        onSuccess: () => {
            // Clear API cache to ensure fresh data
            cacheControl.clear();
            // Invalidate all prompts data to ensure tree and counts are updated
            queryClient.invalidateQueries({ queryKey: promptKeys.all });
        },
    });
}

export function useDeletePromptGroup() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (vars: { id: number; type: PromptType }) => {
            const response = await promptGroupApi.deleteGroup(vars.id, vars.type);
            return response;
        },
        onSuccess: () => {
            cacheControl.clear();
            // Invalidate all prompts data to ensure tree and counts are updated
            queryClient.invalidateQueries({ queryKey: promptKeys.all });
        },
    });
}

export function useMovePrompts() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (vars: { promptIds: number[]; targetGroupId: number | null; type: PromptType }) => {
            const promises = vars.promptIds.map(id =>
                promptGroupApi.movePromptToGroup(id, vars.targetGroupId, vars.type)
            );
            await Promise.all(promises);
        },
        onSuccess: () => {
            cacheControl.clear();
            // Invalidate everything to be safe since prompts moved
            queryClient.invalidateQueries({ queryKey: promptKeys.all });
        },
    });
}

export function useDeletePrompts() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (vars: { promptIds: number[]; type: PromptType }) => {
            const promises = vars.promptIds.map(id =>
                promptCollectionApi.deletePrompt(id, vars.type)
            );
            await Promise.all(promises);
        },
        onSuccess: () => {
            cacheControl.clear();
            queryClient.invalidateQueries({ queryKey: promptKeys.all });
        },
    });
}
