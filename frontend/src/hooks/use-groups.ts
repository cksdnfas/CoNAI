import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { GroupCreateData, GroupUpdateData } from '@conai/shared'
import { groupApi } from '@/services/group-api'

export const groupKeys = {
  all: ['groups'] as const,
  root: (parentId: number | null = null) => [...groupKeys.all, 'root', parentId] as const,
  children: (parentId: number) => [...groupKeys.all, 'children', parentId] as const,
  hierarchy: () => [...groupKeys.all, 'hierarchy'] as const,
  detail: (id: number) => [...groupKeys.all, 'detail', id] as const,
}

export function useRootGroups(parentId: number | null = null) {
  return useQuery({
    queryKey: groupKeys.root(parentId),
    queryFn: async () => {
      const response = await groupApi.getRootGroups()
      if (!response.success || !response.data) {
        throw new Error('Failed to fetch root groups')
      }
      return response.data
    },
    staleTime: 30000,
  })
}

export function useChildGroups(parentId: number | null) {
  return useQuery({
    queryKey: groupKeys.children(parentId ?? 0),
    queryFn: async () => {
      if (parentId === null) return []
      const response = await groupApi.getChildGroups(parentId)
      if (!response.success || !response.data) {
        throw new Error('Failed to fetch child groups')
      }
      return response.data
    },
    enabled: parentId !== null,
    placeholderData: (previousData) => previousData,
    staleTime: 30000,
  })
}

export function useAllGroupsWithHierarchy() {
  return useQuery({
    queryKey: groupKeys.hierarchy(),
    queryFn: async () => {
      const response = await groupApi.getAllGroupsWithHierarchy()
      if (!response.success || !response.data) {
        throw new Error('Failed to fetch groups hierarchy')
      }
      return response.data
    },
    staleTime: 30000,
  })
}

export function useCreateGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: GroupCreateData) => {
      const response = await groupApi.createGroup(data)
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to create group')
      }
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupKeys.all })
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages', 'group'] })
    },
  })
}

export function useUpdateGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: GroupUpdateData }) => {
      const response = await groupApi.updateGroup(id, data)
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to update group')
      }
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: groupKeys.all })
      queryClient.invalidateQueries({ queryKey: groupKeys.detail(data.id) })
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages', 'group'] })
    },
  })
}

export function useDeleteGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, cascade = false }: { id: number; cascade?: boolean }) => {
      const response = await groupApi.deleteGroup(id, cascade)
      if (!response.success) {
        throw new Error(response.error || 'Failed to delete group')
      }
      return id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupKeys.all })
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages', 'group'] })
    },
  })
}

export function useAssignImagesToGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ groupId, imageIds }: { groupId: number; imageIds: string[] }) => {
      const response = await groupApi.addImagesToGroup(groupId, imageIds)
      if (!response.success) {
        throw new Error(response.error || 'Failed to assign images to group')
      }
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupKeys.all })
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages'] })
    },
  })
}

export function useRemoveImagesFromGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ groupId, imageIds }: { groupId: number; imageIds: string[] }) => {
      const response = await groupApi.removeImagesFromGroup(groupId, imageIds)
      if (!response.success) {
        throw new Error('Failed to remove images from group')
      }
      return { removed: response.removed, errors: response.errors }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupKeys.all })
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages'] })
    },
  })
}

export function useRunAutoCollection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (groupId: number) => {
      const response = await groupApi.runAutoCollection(groupId)
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to run auto-collection')
      }
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupKeys.all })
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages'] })
    },
  })
}
