import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPromptGroupStatistics, getPromptGroups, getPromptStatistics, getTopPrompts, searchPromptCollection } from '@/lib/api'
import type { PromptSortBy, PromptSortOrder, PromptTypeFilter } from '@/types/prompt'
import { getPromptTypeTotal, getSortedSiblingGroups } from './prompt-page-utils'

interface UsePromptPageQueriesParams {
  promptType: PromptTypeFilter
  selectedGroupId?: number | null
  searchQuery: string
  page: number
  sortBy: PromptSortBy
  sortOrder: PromptSortOrder
}

export function usePromptPageQueries({ promptType, selectedGroupId, searchQuery, page, sortBy, sortOrder }: UsePromptPageQueriesParams) {
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
    selectedGroup,
    siblingGroups,
    totalCount,
  }
}
