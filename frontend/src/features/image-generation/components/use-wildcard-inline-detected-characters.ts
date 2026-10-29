import { useMemo } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { getDanbooruBrowserCharacters } from '@/lib/api-danbooru-browser'
import { useDebouncedValue } from '@/lib/use-debounced-value'
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

type DanbooruCharacterLookup = Awaited<ReturnType<typeof getDanbooruBrowserCharacters>>
const detectedCharacterQueryKey = (normalizedQuery: string) => ['prompt-inline-detected-character', normalizedQuery] as const

/** Look segments up once typing pauses this long. */
const DETECTED_CHARACTER_LOOKUP_DEBOUNCE_MS = 400

/**
 * Character names found in the prompt's comma segments. Lookups wait for typing to pause and skip the segment under
 * the caret (`caretPosition` -1 when the field is not focused), so typing a name does not query every prefix; matches
 * already found keep showing while the text changes.
 */
export function useWildcardInlineDetectedCharacters(value: string, enabled: boolean, caretPosition: number) {
  const detectedCharacterCandidates = useMemo(
    () => (enabled ? resolvePromptDetectedCharacterCandidates(value) : []),
    [enabled, value],
  )
  // Text and caret settle as one pair, so the caret position always belongs to the text it is checked against.
  const typing = useMemo(() => ({ value, caretPosition }), [caretPosition, value])
  const settled = useDebouncedValue(typing, DETECTED_CHARACTER_LOOKUP_DEBOUNCE_MS)
  const lookupCandidates = useMemo(
    () => (enabled ? resolvePromptDetectedCharacterCandidates(settled.value) : [])
      .filter((candidate) => candidate.normalizedQuery.length >= 2 && (settled.caretPosition < candidate.start || settled.caretPosition > candidate.end)),
    [enabled, settled],
  )
  const detectedCharacterQueries = useQueries({
    queries: lookupCandidates.map((candidate) => ({
      queryKey: detectedCharacterQueryKey(candidate.normalizedQuery),
      queryFn: () => getDanbooruBrowserCharacters({
        query: candidate.query,
        page: 1,
        limit: 5,
        relatedTagLimit: 42,
      }),
      staleTime: 60_000,
      retry: false,
    })),
  })
  const queryClient = useQueryClient()

  // Read every live segment from the cache: a name found before stays matched while its segment is being edited.
  return useMemo(() => {
    const fetched = new Map(lookupCandidates.map((candidate, index) => [candidate.normalizedQuery, detectedCharacterQueries[index]?.data]))
    return detectedCharacterCandidates.flatMap((candidate) => {
      const items = (fetched.get(candidate.normalizedQuery) ?? queryClient.getQueryData<DanbooruCharacterLookup>(detectedCharacterQueryKey(candidate.normalizedQuery)))?.items ?? []
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
    })
  }, [detectedCharacterCandidates, detectedCharacterQueries, lookupCandidates, queryClient])
}
