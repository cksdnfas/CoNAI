import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { autoFolderGroupsApi } from '../services/api/autoFolderGroupsApi';

// Query keys for auto-folder groups
export const autoFolderGroupKeys = {
  all: ['autoFolderGroups'] as const,
  root: () => [...autoFolderGroupKeys.all, 'root'] as const,
  children: (parentId: number) => [...autoFolderGroupKeys.all, 'children', parentId] as const,
  detail: (id: number) => [...autoFolderGroupKeys.all, 'detail', id] as const,
};

// Fetch root auto-folder groups
export function useAutoFolderRootGroups() {
  return useQuery({
    queryKey: autoFolderGroupKeys.root(),
    queryFn: async () => {
      console.log('[useAutoFolderRootGroups] Fetching root groups...');
      const response = await autoFolderGroupsApi.getRootGroups();
      console.log('[useAutoFolderRootGroups] Response:', response);
      if (!response.success || !response.data) {
        throw new Error('Failed to fetch auto-folder root groups');
      }
      return response.data;
    },
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnMount: true,
  });
}

// Fetch child auto-folder groups
export function useAutoFolderChildGroups(parentId: number | null) {
  return useQuery({
    queryKey: autoFolderGroupKeys.children(parentId ?? 0),
    queryFn: async () => {
      if (parentId === null) return [];
      console.log('[useAutoFolderChildGroups] Fetching child groups for parent:', parentId);
      const response = await autoFolderGroupsApi.getChildGroups(parentId);
      console.log('[useAutoFolderChildGroups] Response:', response);
      if (!response.success || !response.data) {
        throw new Error('Failed to fetch auto-folder child groups');
      }
      return response.data;
    },
    enabled: parentId !== null,
    placeholderData: (previousData) => previousData, // Keep previous data while fetching
    staleTime: 30000,
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnMount: true,
  });
}

// Rebuild auto-folder groups mutation
export function useRebuildAutoFolderGroups() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await autoFolderGroupsApi.rebuild();
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to rebuild auto-folder groups');
      }
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all auto-folder group queries
      queryClient.invalidateQueries({ queryKey: autoFolderGroupKeys.all });
      // Also invalidate preview images
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages', 'auto-folder'] });
    },
  });
}
