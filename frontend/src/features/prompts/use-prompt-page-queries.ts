import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPromptGraph, getPromptGroupStatistics, getPromptGroups, getPromptStatistics, getRelatedPrompts, getTopPrompts, searchPromptCollection } from '@/lib/api'
import type { PromptSortBy, PromptSortOrder, PromptTypeFilter } from '@/types/prompt'

interface ActivePromptParams {
  prompt: string
  type: PromptTypeFilter
}
import { getPromptTypeTotal, getSortedSiblingGroups } from './prompt-page-utils'

interface UsePromptPageQueriesParams {
  promptType: PromptTypeFilter
  selectedGroupId?: number | null
  searchQuery: string
  page: number
  sortBy: PromptSortBy
  sortOrder: PromptSortOrder
  activePrompt: ActivePromptParams | null
  graphEnabled?: boolean
  graphFilters?: {
    type: PromptTypeFilter
    minScore: number
    minSharedCount: number
    minUsageCount: number
    limit: number
  }
}

export function usePromptPageQueries({ promptType, selectedGroupId, searchQuery, page, sortBy, sortOrder, activePrompt, graphEnabled = false, graphFilters }: UsePromptPageQueriesParams) {
  const groupsQuery = useQuery({
    queryKey: ['prompt-groups', promptType],
    queryFn: () => getPromptGroups(promptType),
  })

  const statisticsQuery = useQuery({
    queryKey: ['prompt-statistics'],
    queryFn: getPromptStatistics,
  })

  const topPromptsQuery = useQuery({
    queryKey: ['prompt-top', promptType],
    queryFn: () => getTopPrompts({ type: promptType, limit: 9 }),
  })

  const groupStatisticsQuery = useQuery({
    queryKey: ['prompt-group-statistics', promptType],
    queryFn: () => getPromptGroupStatistics(promptType),
  })

  const promptSearchQuery = useQuery({
    queryKey: ['prompt-search', promptType, selectedGroupId, searchQuery, page, sortBy, sortOrder],
    queryFn: () =>
      searchPromptCollection({
        query: searchQuery,
        type: promptType,
        page,
        limit: 40,
        sortBy,
        sortOrder,
        groupId: selectedGroupId ?? undefined,
      }),
  })

  const relatedPromptsQuery = useQuery({
    queryKey: ['prompt-related', activePrompt?.type ?? promptType, activePrompt?.prompt ?? ''],
    queryFn: () => getRelatedPrompts({
      prompt: activePrompt?.prompt ?? '',
      type: activePrompt?.type ?? promptType,
      limit: 12,
    }),
    enabled: Boolean(activePrompt?.prompt),
  })

  const promptGraphQuery = useQuery({
    queryKey: ['prompt-graph', graphFilters?.type ?? 'positive', graphFilters?.minScore ?? 55, graphFilters?.minSharedCount ?? 3, graphFilters?.minUsageCount ?? 2, graphFilters?.limit ?? 180],
    queryFn: () => getPromptGraph({
      type: graphFilters?.type ?? 'positive',
      minScore: graphFilters?.minScore ?? 55,
      minSharedCount: graphFilters?.minSharedCount ?? 3,
      minUsageCount: graphFilters?.minUsageCount ?? 2,
      limit: graphFilters?.limit ?? 180,
    }),
    enabled: graphEnabled,
  })

  const selectedGroup = useMemo(
    () => (groupsQuery.data ?? []).find((group) => group.id === selectedGroupId) ?? null,
    [groupsQuery.data, selectedGroupId],
  )

  const siblingGroups = useMemo(
    () => getSortedSiblingGroups(groupsQuery.data ?? [], selectedGroup),
    [groupsQuery.data, selectedGroup],
  )

  const totalCount = useMemo(
    () => getPromptTypeTotal(promptType, statisticsQuery.data),
    [promptType, statisticsQuery.data],
  )

  return {
    groupsQuery,
    statisticsQuery,
    topPromptsQuery,
    groupStatisticsQuery,
    promptSearchQuery,
    relatedPromptsQuery,
    promptGraphQuery,
    selectedGroup,
    siblingGroups,
    totalCount,
  }
}
