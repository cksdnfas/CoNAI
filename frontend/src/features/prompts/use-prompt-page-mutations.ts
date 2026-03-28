import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  assignPromptToGroup,
  batchAssignPromptsToGroup,
  collectPrompts,
  createPromptGroup,
  deletePrompt,
  deletePromptGroup,
  importPromptGroups,
  reorderPromptGroups,
  updatePromptGroup,
} from '@/lib/api'
import type { PromptGroupExportData, PromptTypeFilter } from '@/types/prompt'

interface UsePromptPageMutationsParams {
  promptType: PromptTypeFilter
  onInfo: (message: string) => void
  onError: (message: string) => void
  onAfterRefresh?: () => Promise<void>
  onAfterSingleAssign?: () => void
  onAfterBatchAssign?: () => void
  onAfterCreateGroup?: (groupId: number) => void
  onAfterUpdateGroup?: () => void
  onAfterDeleteGroup?: () => void
  onAfterCollect?: () => void
  onAfterImport?: () => void
  onAfterDeletePrompt?: (promptId: number) => void
}

export function usePromptPageMutations({
  promptType,
  onInfo,
  onError,
  onAfterRefresh,
  onAfterSingleAssign,
  onAfterBatchAssign,
  onAfterCreateGroup,
  onAfterUpdateGroup,
  onAfterDeleteGroup,
  onAfterCollect,
  onAfterImport,
  onAfterDeletePrompt,
}: UsePromptPageMutationsParams) {
  const queryClient = useQueryClient()

  const refreshPromptQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['prompt-groups', promptType] }),
      queryClient.invalidateQueries({ queryKey: ['prompt-group-statistics', promptType] }),
      queryClient.invalidateQueries({ queryKey: ['prompt-top', promptType] }),
      queryClient.invalidateQueries({ queryKey: ['prompt-search', promptType] }),
      queryClient.invalidateQueries({ queryKey: ['prompt-statistics'] }),
    ])
    await onAfterRefresh?.()
  }

  const assignSinglePromptMutation = useMutation({
    mutationFn: ({ promptId, groupId }: { promptId: number; groupId: number | null }) => assignPromptToGroup(promptId, groupId, promptType),
    onSuccess: async (result) => {
      onAfterSingleAssign?.()
      onInfo(result.message)
      await refreshPromptQueries()
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : '프롬프트 그룹 지정에 실패했어.')
    },
  })

  const batchAssignPromptsMutation = useMutation({
    mutationFn: ({ prompts, groupId }: { prompts: string[]; groupId: number | null }) => batchAssignPromptsToGroup(prompts, groupId, promptType),
    onSuccess: async (result) => {
      onAfterBatchAssign?.()
      onInfo(result.message)
      await refreshPromptQueries()
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : '프롬프트 일괄 그룹 지정에 실패했어.')
    },
  })

  const createPromptGroupMutation = useMutation({
    mutationFn: (input: { group_name: string; parent_id?: number | null; is_visible?: boolean }) => createPromptGroup(input, promptType),
    onSuccess: async (result) => {
      onAfterCreateGroup?.(result.id)
      onInfo(result.message)
      await refreshPromptQueries()
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : '프롬프트 그룹 생성에 실패했어.')
    },
  })

  const updatePromptGroupMutation = useMutation({
    mutationFn: ({ groupId, input }: { groupId: number; input: { group_name?: string; is_visible?: boolean } }) => updatePromptGroup(groupId, input, promptType),
    onSuccess: async (result) => {
      onAfterUpdateGroup?.()
      onInfo(result.message)
      await refreshPromptQueries()
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : '프롬프트 그룹 수정에 실패했어.')
    },
  })

  const deletePromptGroupMutation = useMutation({
    mutationFn: (groupId: number) => deletePromptGroup(groupId, promptType),
    onSuccess: async (result) => {
      onAfterDeleteGroup?.()
      onInfo(result.message)
      await refreshPromptQueries()
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : '프롬프트 그룹 삭제에 실패했어.')
    },
  })

  const reorderPromptGroupsMutation = useMutation({
    mutationFn: (groupOrders: Array<{ id: number; display_order: number }>) => reorderPromptGroups(groupOrders, promptType),
    onSuccess: async (result) => {
      onInfo(result.message)
      await refreshPromptQueries()
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : '프롬프트 그룹 순서 변경에 실패했어.')
    },
  })

  const importPromptGroupsMutation = useMutation({
    mutationFn: (payload: PromptGroupExportData) => importPromptGroups(payload, promptType),
    onSuccess: async (result) => {
      onAfterImport?.()
      onInfo(result.message)
      await refreshPromptQueries()
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : '프롬프트 그룹 import에 실패했어.')
    },
  })

  const deletePromptMutation = useMutation({
    mutationFn: (promptId: number) => deletePrompt(promptId, promptType),
    onSuccess: async (result, promptId) => {
      onAfterDeletePrompt?.(promptId)
      onInfo(result.message)
      await refreshPromptQueries()
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : '프롬프트 삭제에 실패했어.')
    },
  })

  const collectPromptsMutation = useMutation({
    mutationFn: collectPrompts,
    onSuccess: async (result) => {
      onAfterCollect?.()
      onInfo(result.message)
      await refreshPromptQueries()
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : '프롬프트 수동 수집에 실패했어.')
    },
  })

  return {
    assignSinglePromptMutation,
    batchAssignPromptsMutation,
    createPromptGroupMutation,
    updatePromptGroupMutation,
    deletePromptGroupMutation,
    reorderPromptGroupsMutation,
    importPromptGroupsMutation,
    deletePromptMutation,
    collectPromptsMutation,
    refreshPromptQueries,
  }
}
