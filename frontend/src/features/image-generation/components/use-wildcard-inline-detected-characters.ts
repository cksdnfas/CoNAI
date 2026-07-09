import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { getDanbooruBrowserCharacters } from '@/lib/api-danbooru-browser'
import {
  normalizeAutocompleteText,
  resolvePromptDetectedCharacterCandidates,
  type PromptAutocompleteSuggestion,
  type PromptDetectedCharacterCandidate,
} from './use-prompt-inline-autocomplete'

export interface WildcardInlineDetectedCharacter {
  candidate: PromptDetectedCharacterCandidate
  suggestion: PromptAutocompleteSuggestion
}

export function useWildcardInlineDetectedCharacters(value: string, enabled: boolean) {
  const detectedCharacterCandidates = useMemo(
    () => (enabled ? resolvePromptDetectedCharacterCandidates(value) : []),
    [enabled, value],
  )
  const detectedCharacterQueries = useQueries({
    queries: detectedCharacterCandidates.map((candidate) => ({
      queryKey: ['prompt-inline-detected-character', candidate.normalizedQuery],
      queryFn: () => getDanbooruBrowserCharacters({
        query: candidate.query,
        page: 1,
        limit: 5,
        relatedTagLimit: 42,
      }),
      enabled: candidate.normalizedQuery.length >= 2,
      staleTime: 60_000,
      retry: false,
    })),
  })

  return useMemo(() => detectedCharacterCandidates.flatMap((candidate, index) => {
    const items = detectedCharacterQueries[index]?.data?.items ?? []
    const matchedCharacter = items.find((item) => {
      const normalizedName = normalizeAutocompleteText(item.name).replace(/ /g, '_')
      const normalizedDisplayName = normalizeAutocompleteText(item.displayName).replace(/ /g, '_')
      return normalizedName === candidate.normalizedQuery || normalizedDisplayName === candidate.normalizedQuery
    })
    if (!matchedCharacter) {
      return []
    }

    const suggestion: PromptAutocompleteSuggestion = {
      id: `detected-character:${matchedCharacter.tagId}:${candidate.key}`,
      kind: 'character',
      label: matchedCharacter.displayName,
      insertText: matchedCharacter.name,
      translatedName: matchedCharacter.translatedName,
      secondaryText: matchedCharacter.copyrights.map((copyright) => copyright.displayName).slice(0, 2).join(' · '),
      usageCount: matchedCharacter.worksCount,
      relatedTags: matchedCharacter.relatedTags
        .slice()
        .sort((left, right) => right.usageCount - left.usageCount)
        .slice(0, 42),
    }

    return [{ candidate, suggestion }]
  }), [detectedCharacterCandidates, detectedCharacterQueries])
}
