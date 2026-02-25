import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupApi } from '../services/api/groupApi';
import { cacheControl } from '../services/api/apiClient';
import type {
  GroupCreateData,
  GroupUpdateData,
} from '@comfyui-image-manager/shared';

// Query keys
export const groupKeys = {
  all: ['groups'] as const,
  root: (parentId: number | null = null) => [...groupKeys.all, 'root', parentId] as const,
  children: (parentId: number) => [...groupKeys.all, 'children', parentId] as const,
  hierarchy: () => [...groupKeys.all, 'hierarchy'] as const,
  detail: (id: number) => [...groupKeys.all, 'detail', id] as const,
};

// Fetch root groups
export function useRootGroups(parentId: number | null = null) {
  return useQuery({
    queryKey: groupKeys.root(parentId),
    queryFn: async () => {
      const response = await groupApi.getRootGroups();
      if (!response.success || !response.data) {
        throw new Error('Failed to fetch root groups');
      }
      return response.data;
    },
    staleTime: 30000, // 30 seconds
  });
}

// Fetch child groups
export function useChildGroups(parentId: number | null) {
  return useQuery({
    queryKey: groupKeys.children(parentId ?? 0),
    queryFn: async () => {
      if (parentId === null) return [];
      const response = await groupApi.getChildGroups(parentId);
      if (!response.success || !response.data) {
        throw new Error('Failed to fetch child groups');
      }
      return response.data;
    },
    enabled: parentId !== null,
    placeholderData: (previousData) => previousData, // Keep previous data while fetching
    staleTime: 30000,
  });
}

// Fetch all groups with hierarchy (for modals)
export function useAllGroupsWithHierarchy() {
  return useQuery({
    queryKey: groupKeys.hierarchy(),
    queryFn: async () => {
      const response = await groupApi.getAllGroupsWithHierarchy();
      if (!response.success || !response.data) {
        throw new Error('Failed to fetch groups hierarchy');
      }
      return response.data;
    },
    staleTime: 30000,
  });
}

// Create group mutation
export function useCreateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: GroupCreateData) => {
      const response = await groupApi.createGroup(data);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to create group');
      }
      return response.data;
    },
    onSuccess: () => {
      // Clear API cache
      cacheControl.clear();
      // Invalidate all group-related queries
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      // Also invalidate preview images for custom groups only
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages', 'group'] });
    },
  });
}

// Update group mutation
export function useUpdateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: GroupUpdateData }) => {
      const response = await groupApi.updateGroup(id, data);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to update group');
      }
      return response.data;
    },
    onSuccess: (data) => {
      // Clear API cache
      cacheControl.clear();
      // Invalidate all group-related queries
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      // Invalidate specific group detail
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(data.id) });
      // Also invalidate preview images for custom groups only
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages', 'group'] });
    },
  });
}

// Delete group mutation
export function useDeleteGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, cascade = false }: { id: number; cascade?: boolean }) => {
      const response = await groupApi.deleteGroup(id, cascade);
      if (!response.success) {
        throw new Error(response.error || 'Failed to delete group');
      }
      return id;
    },
    onSuccess: () => {
      // Clear API cache
      cacheControl.clear();
      // Invalidate all group-related queries
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      // Also invalidate preview images for custom groups only
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages', 'group'] });
    },
  });
}

// Assign images to group mutation
export function useAssignImagesToGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ groupId, imageIds }: { groupId: number; imageIds: string[] }) => {
      const response = await groupApi.addImagesToGroup(groupId, imageIds);
      if (!response.success) {
        throw new Error(response.error || 'Failed to assign images to group');
      }
      return response.data;
    },
    onSuccess: () => {
      // Clear API cache
      cacheControl.clear();
      // Invalidate group queries to update image counts
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      // Also invalidate preview images
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages'] });
    },
  });
}

// Remove images from group mutation
export function useRemoveImagesFromGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ groupId, imageIds }: { groupId: number; imageIds: string[] }) => {
      const response = await groupApi.removeImagesFromGroup(groupId, imageIds);
      if (!response.success) {
        throw new Error('Failed to remove images from group');
      }
      return { removed: response.removed, errors: response.errors };
    },
    onSuccess: () => {
      // Clear API cache
      cacheControl.clear();
      // Invalidate group queries to update image counts
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      // Also invalidate preview images
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages'] });
    },
  });
}

// Run auto-collection mutation
export function useRunAutoCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (groupId: number) => {
      const response = await groupApi.runAutoCollection(groupId);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to run auto-collection');
      }
      return response.data;
    },
    onSuccess: () => {
      // Clear API cache
      cacheControl.clear();
      // Invalidate group queries to update image counts
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      // Also invalidate preview images
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages'] });
    },
  });
}

