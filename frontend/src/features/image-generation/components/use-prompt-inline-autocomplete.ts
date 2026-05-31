import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDanbooruBrowserCharacters, getDanbooruBrowserTags } from '@/lib/api-danbooru-browser'
import { searchPromptCollection } from '@/lib/api-prompts'
import type { DanbooruBrowserCharacterRecord, DanbooruBrowserRelatedTagRecord, DanbooruBrowserTagRecord } from '@/types/danbooru-browser'
import type { PromptCollectionItem, PromptTypeFilter } from '@/types/prompt'
import type { ActiveWildcardQuery } from './wildcard-inline-picker-helpers'
import { resolveActivePromptTextQuery } from './prompt-inline-token-scanner'

export type PromptAutocompleteQuery = {
  query: string
  start: number
  end: number
}

export type PromptAutocompleteSuggestion = {
  id: string
  kind: 'prompt' | 'tag' | 'character'
  label: string
  insertText: string
  translatedName?: string | null
  secondaryText?: string
  usageCount?: number
  relatedTags?: DanbooruBrowserRelatedTagRecord[]
}

export type PromptDetectedCharacterCandidate = {
  key: string
  query: string
  normalizedQuery: string
  start: number
  end: number
}

export type PromptRelatedTagTab = 'general' | 'character' | 'other'

export const PROMPT_AUTOCOMPLETE_PAGE_SIZE = 7
const PROMPT_AUTOCOMPLETE_RELATED_TAG_LIMIT = 42
const PROMPT_AUTOCOMPLETE_LABEL_MAX_LENGTH = 48
export const PROMPT_RELATED_TAG_TABS: Array<{ id: PromptRelatedTagTab; label: string }> = [
  { id: 'general', label: '일반' },
  { id: 'character', label: '캐릭터' },
  { id: 'other', label: '그외' },
]

export function normalizeAutocompleteText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeAutocompleteLookup(value: string) {
  return normalizeAutocompleteText(value).replace(/ /g, '_')
}

export function resolvePromptDetectedCharacterCandidates(value: string, limit = 8): PromptDetectedCharacterCandidate[] {
  const candidates: PromptDetectedCharacterCandidate[] = []
  const seen = new Set<string>()
  let segmentStart = 0

  const flushSegment = (segmentEnd: number) => {
    let start = segmentStart
    let end = segmentEnd
    while (start < end && /\s/.test(value[start] ?? '')) start += 1
    while (end > start && /\s/.test(value[end - 1] ?? '')) end -= 1
    const query = value.slice(start, end)
    if (!query || query.includes('__') || query.includes('++') || /[()[\]{}<>]/.test(query)) {
      return
    }

    const normalizedQuery = normalizeAutocompleteLookup(query)
    if (!normalizedQuery || seen.has(normalizedQuery)) {
      return
    }

    seen.add(normalizedQuery)
    candidates.push({
      key: `${start}:${end}:${normalizedQuery}`,
      query,
      normalizedQuery,
      start,
      end,
    })
  }

  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index] ?? ','
    if (character === ',' || character === '\n' || character === '\r') {
      flushSegment(index)
      segmentStart = index + 1
      if (candidates.length >= limit) {
        break
      }
    }
  }

  return candidates.slice(0, limit)
}

export function buildPromptAutocompleteInsertion(value: string, insertionText: string, range: PromptAutocompleteQuery, mode: 'replace' | 'append' = 'replace') {
  const insertionPoint = mode === 'append' ? range.end : range.start
  const replaceEnd = mode === 'append' ? range.end : range.end
  const before = value.slice(0, insertionPoint)
  const after = value.slice(replaceEnd)
  const trimmedAfter = after.replace(/^\s+/, '')
  const needsPrefix = mode === 'append' && before.length > 0 && !/[\s,\n]$/.test(before)
  const needsSuffix = trimmedAfter.length === 0 || !/^[,\n]/.test(trimmedAfter)
  const prefix = needsPrefix ? ', ' : ''
  const suffix = needsSuffix ? ', ' : ''
  const nextValue = `${before}${prefix}${insertionText}${suffix}${trimmedAfter}`
  const nextCaretPosition = before.length + prefix.length + insertionText.length + suffix.length

  return { nextValue, nextCaretPosition }
}

function getAutocompleteUsageCount(suggestion: Pick<PromptAutocompleteSuggestion, 'usageCount'>) {
  return suggestion.usageCount ?? 0
}

function buildPromptAutocompleteSuggestions({
  prompts,
  tags,
  characters,
}: {
  prompts: PromptCollectionItem[]
  tags: DanbooruBrowserTagRecord[]
  characters: DanbooruBrowserCharacterRecord[]
}): PromptAutocompleteSuggestion[] {
  const suggestions: PromptAutocompleteSuggestion[] = [
    ...prompts.map((item) => ({
      id: `prompt:${item.type}:${item.id}`,
      kind: 'prompt' as const,
      label: item.prompt,
      insertText: item.prompt,
      secondaryText: item.group_info?.group_name ?? item.type,
      usageCount: item.usage_count,
    })),
    ...characters.map((item) => ({
      id: `character:${item.tagId}`,
      kind: 'character' as const,
      label: item.displayName,
      insertText: item.name,
      translatedName: item.translatedName,
      secondaryText: item.copyrights.map((copyright) => copyright.displayName).slice(0, 2).join(' · '),
      usageCount: item.worksCount,
      relatedTags: item.relatedTags
        .slice()
        .sort((left, right) => right.usageCount - left.usageCount)
        .slice(0, PROMPT_AUTOCOMPLETE_RELATED_TAG_LIMIT),
    })),
    ...tags.map((item) => ({
      id: `tag:${item.id}`,
      kind: 'tag' as const,
      label: item.displayName,
      insertText: item.name,
      translatedName: item.translatedName,
      secondaryText: 'Danbooru tag',
      usageCount: item.usageCount,
    })),
  ]

  const seen = new Set<string>()
  return suggestions
    .filter((suggestion) => {
      const key = normalizeAutocompleteText(suggestion.insertText)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .sort((left, right) => getAutocompleteUsageCount(right) - getAutocompleteUsageCount(left))
}

export function getRelatedTagTab(categoryName: string): PromptRelatedTagTab {
  const normalizedCategoryName = categoryName.toLowerCase()
  if (normalizedCategoryName === 'general') {
    return 'general'
  }
  if (normalizedCategoryName === 'character') {
    return 'character'
  }
  return 'other'
}

export function getPromptAutocompleteKindLabel(kind: PromptAutocompleteSuggestion['kind']) {
  if (kind === 'character') {
    return '캐릭터'
  }
  if (kind === 'tag') {
    return '단부루'
  }
  return '프롬프트'
}

function formatPromptAutocompleteCount(count: number | undefined) {
  if (count === undefined) {
    return null
  }
  if (count < 100) {
    return String(count)
  }

  const value = count / 1000
  return `${value.toFixed(1).replace(/\.0$/, '')}K`
}

function truncatePromptAutocompleteText(text: string, maxLength = PROMPT_AUTOCOMPLETE_LABEL_MAX_LENGTH) {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function formatPromptAutocompleteLabel(item: Pick<PromptAutocompleteSuggestion, 'label' | 'translatedName' | 'usageCount'>) {
  const labelText = truncatePromptAutocompleteText(item.label)
  const translatedText = item.translatedName?.trim()
  const formattedCount = formatPromptAutocompleteCount(item.usageCount)
  const countText = formattedCount ? ` (${formattedCount})` : ''
  return `${labelText}${translatedText ? ` [${truncatePromptAutocompleteText(translatedText, 24)}]` : ''}${countText}`
}

function isSameAutocompleteCharacter(left: PromptAutocompleteSuggestion | null, right: PromptAutocompleteSuggestion | null) {
  return left?.kind === 'character' && right?.kind === 'character' && left.id === right.id
}

export function usePromptInlineAutocomplete({
  value,
  caretPosition,
  activeWildcardQuery,
  isExplorerPinned,
  isFocused,
  disabled,
  isWildcardPopupOpen,
  autocompletePromptType,
}: {
  value: string
  caretPosition: number
  activeWildcardQuery: ActiveWildcardQuery | null
  isExplorerPinned: boolean
  isFocused: boolean
  disabled: boolean
  isWildcardPopupOpen: boolean
  autocompletePromptType: PromptTypeFilter
}) {
  const [selectedCharacter, setSelectedCharacter] = useState<PromptAutocompleteSuggestion | null>(null)
  const activeQuery = useMemo(
    () => (activeWildcardQuery === null && !isExplorerPinned ? resolveActivePromptTextQuery(value, caretPosition) : null),
    [activeWildcardQuery, caretPosition, isExplorerPinned, value],
  )
  const searchText = activeQuery?.query.trim() ?? ''
  const isOpen = isFocused && !disabled && !isWildcardPopupOpen && activeQuery !== null

  const promptsQuery = useQuery({
    queryKey: ['prompt-inline-autocomplete', 'collection', autocompletePromptType, searchText],
    queryFn: () => searchPromptCollection({
      query: searchText,
      type: autocompletePromptType,
      page: 1,
      limit: PROMPT_AUTOCOMPLETE_PAGE_SIZE * 3,
      sortBy: 'usage_count',
      sortOrder: 'DESC',
    }),
    enabled: isOpen,
    staleTime: 30_000,
  })
  const tagsQuery = useQuery({
    queryKey: ['prompt-inline-autocomplete', 'danbooru-tags', searchText],
    queryFn: () => getDanbooruBrowserTags({ query: searchText, page: 1, limit: PROMPT_AUTOCOMPLETE_PAGE_SIZE * 3 }),
    enabled: isOpen && searchText.length > 0,
    staleTime: 60_000,
    retry: false,
  })
  const charactersQuery = useQuery({
    queryKey: ['prompt-inline-autocomplete', 'danbooru-characters', searchText],
    queryFn: () => getDanbooruBrowserCharacters({
      query: searchText,
      page: 1,
      limit: PROMPT_AUTOCOMPLETE_PAGE_SIZE * 3,
      relatedTagLimit: PROMPT_AUTOCOMPLETE_RELATED_TAG_LIMIT,
    }),
    enabled: isOpen && searchText.length >= 2,
    staleTime: 60_000,
    retry: false,
  })
  const suggestions = useMemo(
    () => buildPromptAutocompleteSuggestions({
      prompts: promptsQuery.data?.items ?? [],
      tags: tagsQuery.data?.items ?? [],
      characters: charactersQuery.data?.items ?? [],
    }),
    [charactersQuery.data?.items, promptsQuery.data?.items, tagsQuery.data?.items],
  )
  const exactCharacter = useMemo(() => {
    const normalizedQuery = normalizeAutocompleteLookup(searchText)
    if (!normalizedQuery) {
      return null
    }

    return suggestions.find((suggestion) => (
      suggestion.kind === 'character'
        && (normalizeAutocompleteLookup(suggestion.insertText) === normalizedQuery || normalizeAutocompleteLookup(suggestion.label) === normalizedQuery)
    )) ?? null
  }, [searchText, suggestions])
  const activeCharacter = isSameAutocompleteCharacter(selectedCharacter, exactCharacter)
    ? selectedCharacter
    : (selectedCharacter ?? exactCharacter)
  const isLoading = promptsQuery.isLoading || tagsQuery.isLoading || charactersQuery.isLoading

  useEffect(() => {
    if (selectedCharacter && searchText.length > 0 && normalizeAutocompleteText(selectedCharacter.insertText) !== normalizeAutocompleteText(searchText)) {
      setSelectedCharacter(null)
    }
  }, [searchText, selectedCharacter])

  return {
    activeQuery,
    isOpen,
    suggestions,
    activeCharacter,
    isLoading,
    setSelectedCharacter,
  }
}
