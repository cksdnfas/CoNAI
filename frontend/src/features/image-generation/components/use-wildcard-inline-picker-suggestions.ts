import { useMemo } from 'react'
import type { PromptInlineSyntaxSettings, PromptInlineSyntaxSource } from './prompt-inline-syntax-settings'
import { resolveActivePromptTextQuery, type ActivePromptTokenQuery } from './prompt-inline-token-scanner'
import {
  countStoredWildcardItemsForTool,
  countWildcardItemsForTool,
  scoreWildcardMatch,
  type FlattenedWildcardRecord,
  type PromptWildcardTool,
} from './wildcard-inline-picker-helpers'

export type WildcardInlinePickerSuggestion = {
  record: FlattenedWildcardRecord
  score: number
  toolItemCount: number
  generalItemCount: number
  naiItemCount: number
  comfyuiItemCount: number
}

export type IndexedWildcardInlinePickerSuggestion = WildcardInlinePickerSuggestion & { index: number }

interface UseWildcardInlinePickerSuggestionsOptions {
  value: string
  caretPosition: number
  syntaxSettings: PromptInlineSyntaxSettings
  flattenedWildcards: FlattenedWildcardRecord[]
  tool: PromptWildcardTool
}

function createWildcardSuggestion(record: FlattenedWildcardRecord, normalizedQuery: string, tool: PromptWildcardTool): WildcardInlinePickerSuggestion {
  return {
    record,
    score: scoreWildcardMatch(record, normalizedQuery),
    toolItemCount: countWildcardItemsForTool(record.items, tool),
    generalItemCount: countStoredWildcardItemsForTool(record.items, 'general'),
    naiItemCount: countStoredWildcardItemsForTool(record.items, 'nai'),
    comfyuiItemCount: countStoredWildcardItemsForTool(record.items, 'comfyui'),
  }
}

/** Plain-word popups: preprocess chain keywords and tag suggestions (random sources use the `@` / `__` palette). */
export function useWildcardInlinePickerSuggestions({
  value,
  caretPosition,
  syntaxSettings,
  flattenedWildcards,
  tool,
}: UseWildcardInlinePickerSuggestionsOptions) {
  const activeTextQuery = useMemo(
    () => ((syntaxSettings.triggers.preprocess || syntaxSettings.triggers.tag) ? resolveActivePromptTextQuery(value, caretPosition) : null),
    [caretPosition, syntaxSettings.triggers.preprocess, syntaxSettings.triggers.tag, value],
  )

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
      .map((record) => createWildcardSuggestion(record, normalizedQuery, tool))
      .filter(({ score }) => score >= 0)
      .sort((left, right) => right.score - left.score || left.record.path.join('/').localeCompare(right.record.path.join('/')))
      .slice(0, 8)
  }, [activeTextQuery, flattenedWildcards, tool])

  const activeSource = useMemo<PromptInlineSyntaxSource | null>(() => {
    for (const source of syntaxSettings.priority) {
      if (!syntaxSettings.triggers[source] || !activeTextQuery) {
        continue
      }
      if (source === 'preprocess' && preprocessSuggestions.length > 0) {
        return source
      }
      if (source === 'tag') {
        return source
      }
    }
    return null
  }, [activeTextQuery, preprocessSuggestions.length, syntaxSettings.priority, syntaxSettings.triggers])

  const activePreprocessQuery: ActivePromptTokenQuery | null = activeSource === 'preprocess' ? activeTextQuery : null
  const indexedSuggestions: IndexedWildcardInlinePickerSuggestion[] = activeSource === 'preprocess'
    ? preprocessSuggestions.map((suggestion, index) => ({ ...suggestion, index }))
    : []

  return {
    activeTextQuery,
    activeSource,
    activePreprocessQuery,
    preprocessSuggestions,
    normalizedActiveQuery: activePreprocessQuery?.query.trim() ?? '',
    indexedSuggestions,
  }
}
