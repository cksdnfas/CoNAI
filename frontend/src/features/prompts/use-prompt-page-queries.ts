import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPromptGraph, getPromptGroupStatistics, getPromptGroups, getPromptStatistics, getPromptTaxonomyGraph, getTopPrompts, searchPromptCollection } from '@/lib/api'
import type { PromptSortBy, PromptSortOrder, PromptTaxonomyInferredType, PromptTaxonomyRelationKind, PromptTypeFilter } from '@/types/prompt'
import { getPromptTypeTotal, getSortedSiblingGroups } from './prompt-page-utils'

interface UsePromptPageQueriesParams {
  promptType: PromptTypeFilter
  selectedGroupId?: number | null
  searchQuery: string
  page: number
  sortBy: PromptSortBy
  sortOrder: PromptSortOrder
  graphEnabled?: boolean
  graphFilters?: {
    type: PromptTypeFilter
    minScore: number
    minSharedCount: number
    minUsageCount: number
    limit: number
  }
  taxonomyGraphEnabled?: boolean
  taxonomyGraphFilters?: {
    type: PromptTypeFilter
    inferredType: PromptTaxonomyInferredType | 'all'
    relationKind: PromptTaxonomyRelationKind | 'all'
    minScore: number
    limit: number
  }
}

export function usePromptPageQueries({ promptType, selectedGroupId, searchQuery, page, sortBy, sortOrder, graphEnabled = false, graphFilters, taxonomyGraphEnabled = false, taxonomyGraphFilters }: UsePromptPageQueriesParams) {
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

  const promptTaxonomyGraphQuery = useQuery({
    queryKey: ['prompt-taxonomy-graph', taxonomyGraphFilters?.type ?? 'positive', taxonomyGraphFilters?.inferredType ?? 'all', taxonomyGraphFilters?.relationKind ?? 'all', taxonomyGraphFilters?.minScore ?? 0.58, taxonomyGraphFilters?.limit ?? 180],
    queryFn: () => getPromptTaxonomyGraph({
      type: taxonomyGraphFilters?.type ?? 'positive',
      inferredType: taxonomyGraphFilters?.inferredType ?? 'all',
      relationKind: taxonomyGraphFilters?.relationKind ?? 'all',
      minScore: taxonomyGraphFilters?.minScore ?? 0.58,
      limit: taxonomyGraphFilters?.limit ?? 180,
    }),
    enabled: taxonomyGraphEnabled,
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
    promptGraphQuery,
    promptTaxonomyGraphQuery,
    selectedGroup,
    siblingGroups,
    totalCount,
  }
}
