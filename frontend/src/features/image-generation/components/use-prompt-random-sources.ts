import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { getDanbooruBrowserSummary } from '@/lib/api-danbooru-browser'
import { getPromptGroups } from '@/lib/api-prompts'
import type { PromptTypeFilter } from '@/types/prompt'
import type { FlattenedWildcardRecord } from './wildcard-inline-picker-helpers'
import { findClosestName, type PromptRandomToken, type PromptRandomTokenSource } from './prompt-random-token'

export type PromptRandomSourceEntry = {
  id: string
  source: PromptRandomTokenSource
  /** Name written into the token. */
  name: string
  translatedName: string | null
  count: number
  wildcard?: FlattenedWildcardRecord
  taxonomyNodeId?: number
  groupId?: number
}

/** `ok` resolves, `missing` turns into an empty value at generation, `pending` while lists load. */
export type PromptRandomTokenStatus = { state: 'ok' | 'missing' | 'pending'; source: PromptRandomTokenSource; suggestion: string | null }

function normalizeSourceName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * Lists every random source (wildcards, Danbooru tag groups, my prompt groups) and checks tokens against them.
 * The palette lists the prompt groups of the field's own type; `__my:` resolves positive groups first, then negative
 * (WildcardService.expandRandomTokens), so token checks accept either.
 */
export function usePromptRandomSources({ flattenedWildcards, wildcardsReady, enabled, promptType }: {
  flattenedWildcards: FlattenedWildcardRecord[]
  wildcardsReady: boolean
  enabled: boolean
  promptType: PromptTypeFilter
}) {
  const { canViewPrompts } = useFeaturePermissions()
  const summaryQuery = useQuery({
    queryKey: ['danbooru-browser-summary', 'inline-group-picker'],
    queryFn: getDanbooruBrowserSummary,
    enabled: enabled && canViewPrompts,
    staleTime: 60_000,
    retry: false,
  })
  const positiveGroupsQuery = useQuery({
    queryKey: ['prompt-groups', 'random-source', 'positive'],
    queryFn: () => getPromptGroups('positive'),
    enabled: enabled && canViewPrompts,
    staleTime: 60_000,
  })
  const negativeGroupsQuery = useQuery({
    queryKey: ['prompt-groups', 'random-source', 'negative'],
    queryFn: () => getPromptGroups('negative'),
    enabled: enabled && canViewPrompts,
    staleTime: 60_000,
  })
  const myGroupsQuery = promptType === 'negative' ? negativeGroupsQuery : positiveGroupsQuery

  const entries = useMemo<PromptRandomSourceEntry[]>(() => [
    ...flattenedWildcards
      .filter((record) => record.type === 'wildcard' && !record.isAutoCollected)
      .map((record) => ({ id: `wildcard:${record.id}`, source: 'wildcard' as const, name: record.name, translatedName: record.path.length > 1 ? record.path.slice(0, -1).join(' / ') : null, count: record.items.length, wildcard: record })),
    ...(summaryQuery.data?.tree ?? [])
      .filter((node) => node.section === 'tags' && node.filter?.taxonomyNodeId !== undefined)
      .map((node) => ({ id: `tag:${node.id}`, source: 'tag' as const, name: node.label, translatedName: node.translatedLabel ?? null, count: node.count, taxonomyNodeId: node.filter?.taxonomyNodeId })),
    ...(myGroupsQuery.data ?? [])
      .filter((group) => group.id > 0)
      .map((group) => ({ id: `my:${group.id}`, source: 'my' as const, name: group.group_name, translatedName: null, count: group.prompt_count ?? 0, groupId: group.id })),
  ], [flattenedWildcards, myGroupsQuery.data, summaryQuery.data?.tree])

  const namesBySource = useMemo(() => {
    const names: Record<PromptRandomTokenSource, Set<string>> = { wildcard: new Set(), tag: new Set(), my: new Set() }
    for (const entry of entries) {
      names[entry.source].add(normalizeSourceName(entry.name))
      if (entry.source === 'tag' && entry.translatedName) {
        names.tag.add(normalizeSourceName(entry.translatedName))
      }
    }
    for (const group of [...(positiveGroupsQuery.data ?? []), ...(negativeGroupsQuery.data ?? [])]) {
      names.my.add(normalizeSourceName(group.group_name))
    }
    return names
  }, [entries, negativeGroupsQuery.data, positiveGroupsQuery.data])

  const isWildcardName = useCallback((name: string) => namesBySource.wildcard.has(normalizeSourceName(name)), [namesBySource])

  const getTokenStatus = useCallback((token: PromptRandomToken): PromptRandomTokenStatus => {
    const name = normalizeSourceName(token.name)
    const readyBySource: Record<PromptRandomTokenSource, boolean> = {
      wildcard: wildcardsReady,
      tag: summaryQuery.isSuccess || !canViewPrompts,
      my: (positiveGroupsQuery.isSuccess && negativeGroupsQuery.isSuccess) || !canViewPrompts,
    }
    // 접두사 없는 토큰: 와일드카드가 없으면 백엔드가 태그 그룹으로 해석
    const source: PromptRandomTokenSource = token.unprefixed && wildcardsReady && !namesBySource.wildcard.has(name) && !token.raw.startsWith('++') ? 'tag' : token.source
    if (!readyBySource[source] || (source === 'tag' && !canViewPrompts)) {
      return { state: 'pending', source, suggestion: null }
    }
    if (namesBySource[source].has(name)) {
      return { state: 'ok', source, suggestion: null }
    }
    const candidates = entries.filter((entry) => entry.source === source).map((entry) => entry.name)
    return { state: 'missing', source, suggestion: findClosestName(token.name, candidates) }
  }, [canViewPrompts, entries, namesBySource, negativeGroupsQuery.isSuccess, positiveGroupsQuery.isSuccess, summaryQuery.isSuccess, wildcardsReady])

  return {
    entries,
    isWildcardName,
    getTokenStatus,
    isLoading: summaryQuery.isLoading || myGroupsQuery.isLoading,
  }
}
