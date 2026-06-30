import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDanbooruBrowserSummary } from '@/lib/api-danbooru-browser'
import type { PromptInlineSyntaxSettings, PromptInlineSyntaxSource } from './prompt-inline-syntax-settings'
import { resolveActiveDanbooruGroupQuery, resolveActivePromptTextQuery, type ActivePromptTokenQuery } from './prompt-inline-token-scanner'
import {
  countStoredWildcardItemsForTool,
  countWildcardItemsForTool,
  resolveActiveWildcardQuery,
  scoreWildcardMatch,
  type FlattenedWildcardRecord,
  type PromptWildcardTool,
  type WildcardFilterMode,
} from './wildcard-inline-picker-helpers'

export type WildcardInlinePickerSuggestion = {
  record: FlattenedWildcardRecord
  score: number
  toolItemCount: number
  generalItemCount: number
  naiItemCount: number
  comfyuiItemCount: number
  recentIndex: number
}

export type IndexedWildcardInlinePickerSuggestion = WildcardInlinePickerSuggestion & { index: number }

export type WildcardInlinePickerGroupSuggestion = {
  id: string
  label: string
  translatedLabel: string | null
  count: number
  taxonomyNodeId: number
  score: number
}

interface UseWildcardInlinePickerSuggestionsOptions {
  value: string
  caretPosition: number
  syntaxSettings: PromptInlineSyntaxSettings
  flattenedWildcards: FlattenedWildcardRecord[]
  filterMode: WildcardFilterMode
  recentWildcardNames: string[]
  tool: PromptWildcardTool
}

function createWildcardSuggestion(record: FlattenedWildcardRecord, normalizedQuery: string, tool: PromptWildcardTool, recentIndex: number): WildcardInlinePickerSuggestion {
  return {
    record,
    score: scoreWildcardMatch(record, normalizedQuery),
    toolItemCount: countWildcardItemsForTool(record.items, tool),
    generalItemCount: countStoredWildcardItemsForTool(record.items, 'general'),
    naiItemCount: countStoredWildcardItemsForTool(record.items, 'nai'),
    comfyuiItemCount: countStoredWildcardItemsForTool(record.items, 'comfyui'),
    recentIndex,
  }
}

export function useWildcardInlinePickerSuggestions({
  value,
  caretPosition,
  syntaxSettings,
  flattenedWildcards,
  filterMode,
  recentWildcardNames,
  tool,
}: UseWildcardInlinePickerSuggestionsOptions) {
  const activeGroupQuery = useMemo(
    () => (syntaxSettings.triggers['danbooru-group'] ? resolveActiveDanbooruGroupQuery(value, caretPosition) : null),
    [caretPosition, syntaxSettings.triggers, value],
  )
  const activeWildcardQuery = useMemo(
    () => (syntaxSettings.triggers.wildcard ? resolveActiveWildcardQuery(value, caretPosition) : null),
    [caretPosition, syntaxSettings.triggers.wildcard, value],
  )
  const activeTextQuery = useMemo(
    () => ((syntaxSettings.triggers.preprocess || syntaxSettings.triggers.tag) ? resolveActivePromptTextQuery(value, caretPosition) : null),
    [caretPosition, syntaxSettings.triggers.preprocess, syntaxSettings.triggers.tag, value],
  )

  const danbooruSummaryQuery = useQuery({
    queryKey: ['danbooru-browser-summary', 'inline-group-picker'],
    queryFn: getDanbooruBrowserSummary,
    enabled: activeGroupQuery !== null,
    staleTime: 60_000,
    retry: false,
  })

  const preprocessSuggestions = useMemo(() => {
    if (!activeTextQuery) {
      return []
    }

    const normalizedQuery = activeTextQuery.query.trim().toLowerCase()
    if (!normalizedQuery) {
      return []
    }

    return flattenedWildcards
      .filter((record) => record.type === 'chain' && !record.isAutoCollected)
      .map((record) => createWildcardSuggestion(record, normalizedQuery, tool, Number.POSITIVE_INFINITY))
      .filter(({ score }) => score >= 0)
      .sort((left, right) => right.score - left.score || left.record.path.join('/').localeCompare(right.record.path.join('/')))
      .slice(0, 8)
  }, [activeTextQuery, flattenedWildcards, tool])

  const groupSuggestions = useMemo<WildcardInlinePickerGroupSuggestion[]>(() => {
    if (!activeGroupQuery) {
      return []
    }

    const normalizedQuery = activeGroupQuery.query.trim().toLowerCase().replace(/\s+/g, '_')
    return (danbooruSummaryQuery.data?.tree ?? [])
      .filter((node) => node.section === 'tags' && node.filter?.taxonomyNodeId !== undefined)
      .map((node) => {
        const label = node.label
        const translatedLabel = node.translatedLabel ?? null
        const searchable = `${label} ${translatedLabel ?? ''}`.toLowerCase().replace(/\s+/g, '_')
        const score = !normalizedQuery
          ? node.count
          : searchable.startsWith(normalizedQuery)
            ? 1_000_000 + node.count
            : searchable.includes(normalizedQuery)
              ? 500_000 + node.count
              : -1

        return {
          id: node.id,
          label,
          translatedLabel,
          count: node.count,
          taxonomyNodeId: node.filter?.taxonomyNodeId ?? 0,
          score,
        }
      })
      .filter((suggestion) => suggestion.score >= 0)
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
      .slice(0, 10)
  }, [activeGroupQuery, danbooruSummaryQuery.data?.tree])

  const activeSource = useMemo<PromptInlineSyntaxSource | null>(() => {
    for (const source of syntaxSettings.priority) {
      if (!syntaxSettings.triggers[source]) {
        continue
      }
      if (source === 'danbooru-group' && activeGroupQuery) {
        return source
      }
      if (source === 'preprocess' && activeTextQuery && preprocessSuggestions.length > 0) {
        return source
      }
      if (source === 'wildcard' && activeWildcardQuery) {
        return source
      }
      if (source === 'tag' && activeTextQuery) {
        return source
      }
    }
    return null
  }, [activeGroupQuery, activeTextQuery, activeWildcardQuery, preprocessSuggestions.length, syntaxSettings.priority, syntaxSettings.triggers])

  const activeQuery = activeSource === 'wildcard' ? activeWildcardQuery : null
  const activePreprocessQuery: ActivePromptTokenQuery | null = activeSource === 'preprocess' ? activeTextQuery : null
  const activeDanbooruGroupQuery: ActivePromptTokenQuery | null = activeSource === 'danbooru-group' ? activeGroupQuery : null

  const suggestions = useMemo(() => {
    if (!activeQuery) {
      return []
    }

    const normalizedQuery = activeQuery.query.trim().toLowerCase()
    const recentIndexMap = new Map(recentWildcardNames.map((name, index) => [name, index]))
    return flattenedWildcards
      .map((record) => createWildcardSuggestion(record, normalizedQuery, tool, recentIndexMap.get(record.name) ?? Number.POSITIVE_INFINITY))
      .filter(({ score, toolItemCount }) => {
        if (normalizedQuery.length > 0 && score < 0) {
          return false
        }

        if (filterMode === 'available-only' && toolItemCount === 0) {
          return false
        }

        return true
      })
      .sort((left, right) => {
        if (normalizedQuery.length === 0 && left.recentIndex !== right.recentIndex) {
          return left.recentIndex - right.recentIndex
        }

        if (right.score !== left.score) {
          return right.score - left.score
        }

        if (left.recentIndex !== right.recentIndex) {
          return left.recentIndex - right.recentIndex
        }

        if (right.toolItemCount !== left.toolItemCount) {
          return right.toolItemCount - left.toolItemCount
        }

        return left.record.path.join('/').localeCompare(right.record.path.join('/'))
      })
      .slice(0, 8)
  }, [activeQuery, filterMode, flattenedWildcards, recentWildcardNames, tool])

  const normalizedActiveQuery = activePreprocessQuery?.query.trim() ?? activeDanbooruGroupQuery?.query.trim() ?? activeQuery?.query.trim() ?? ''
  const activeListSuggestions = activeSource === 'preprocess' ? preprocessSuggestions : suggestions
  const indexedSuggestions: IndexedWildcardInlinePickerSuggestion[] = activeListSuggestions.map((suggestion, index) => ({ ...suggestion, index }))
  const recentSuggestions = activeSource === 'wildcard' && normalizedActiveQuery.length === 0
    ? indexedSuggestions.filter((suggestion) => Number.isFinite(suggestion.recentIndex))
    : []
  const remainingSuggestions = activeSource === 'wildcard' && normalizedActiveQuery.length === 0
    ? indexedSuggestions.filter((suggestion) => !Number.isFinite(suggestion.recentIndex))
    : indexedSuggestions

  return {
    activeGroupQuery,
    activeWildcardQuery,
    activeTextQuery,
    activeSource,
    activeQuery,
    activePreprocessQuery,
    activeDanbooruGroupQuery,
    danbooruSummaryQuery,
    preprocessSuggestions,
    groupSuggestions,
    suggestions,
    normalizedActiveQuery,
    activeListSuggestions,
    indexedSuggestions,
    recentSuggestions,
    remainingSuggestions,
  }
}
