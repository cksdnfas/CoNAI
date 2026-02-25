import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { autoFolderGroupsApi } from '@/services/auto-folder-groups-api'

export const autoFolderGroupKeys = {
  all: ['autoFolderGroups'] as const,
  root: () => [...autoFolderGroupKeys.all, 'root'] as const,
  children: (parentId: number) => [...autoFolderGroupKeys.all, 'children', parentId] as const,
  detail: (id: number) => [...autoFolderGroupKeys.all, 'detail', id] as const,
}

export function useAutoFolderRootGroups() {
  return useQuery({
    queryKey: autoFolderGroupKeys.root(),
    queryFn: async () => {
      const response = await autoFolderGroupsApi.getRootGroups()
      if (!response.success || !response.data) {
        throw new Error('Failed to fetch auto-folder root groups')
      }
      return response.data
    },
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: true,
  })
}

export function useAutoFolderChildGroups(parentId: number | null) {
  return useQuery({
    queryKey: autoFolderGroupKeys.children(parentId ?? 0),
    queryFn: async () => {
      if (parentId === null) return []

      const response = await autoFolderGroupsApi.getChildGroups(parentId)
      if (!response.success || !response.data) {
        throw new Error('Failed to fetch auto-folder child groups')
      }
      return response.data
    },
    enabled: parentId !== null,
    placeholderData: (previousData) => previousData,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: true,
  })
}

export function useRebuildAutoFolderGroups() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await autoFolderGroupsApi.rebuild()
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to rebuild auto-folder groups')
      }
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: autoFolderGroupKeys.all })
      queryClient.invalidateQueries({ queryKey: ['groupPreviewImages', 'auto-folder'] })
    },
  })
}
