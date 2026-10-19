import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getPromptSuggestions, type PromptSuggestResponse } from '@/lib/api-prompts'
import type { DanbooruBrowserCharacterRecord, DanbooruBrowserRelatedTagRecord, DanbooruBrowserTagRecord } from '@/types/danbooru-browser'
import type { PromptTypeFilter } from '@/types/prompt'
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
  /** How many recent images used this together with the current prompt's terms. */
  relatedCount?: number
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
/** Rows shown in the keyboard-navigable suggestion list. */
export const PROMPT_AUTOCOMPLETE_LIST_SIZE = 10
const PROMPT_AUTOCOMPLETE_DEBOUNCE_MS = 150
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

/** Danbooru tag name as prompt text: underscores become spaces unless kept by setting, except short emoticon tags such as `^_^`. */
export function formatDanbooruTagForPrompt(name: string, keepUnderscores = false) {
  return keepUnderscores || name.length <= 3 ? name : name.replace(/_/g, ' ')
}

/** 3 = exact, 2 = starts with the query, 1 = contains it. */
function getAutocompleteMatchTier(suggestion: PromptAutocompleteSuggestion, normalizedQuery: string) {
  const candidates = [suggestion.insertText, suggestion.label].map(normalizeAutocompleteLookup)
  if (candidates.some((candidate) => candidate === normalizedQuery)) {
    return 3
  }
  if (candidates.some((candidate) => candidate.startsWith(normalizedQuery))) {
    return 2
  }
  return 1
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
  query,
  prompts,
  tags,
  characters,
  related,
  tagUnderscores,
}: {
  query: string
  prompts: PromptSuggestResponse['prompts']
  tags: DanbooruBrowserTagRecord[]
  characters: DanbooruBrowserCharacterRecord[]
  related: PromptSuggestResponse['related']
  tagUnderscores: boolean
}): PromptAutocompleteSuggestion[] {
  const relatedCountByTerm = new Map(related.map((item) => [normalizeAutocompleteLookup(item.term), item.count]))
  const suggestions: PromptAutocompleteSuggestion[] = [
    ...prompts.map((item) => ({
      id: `prompt:${item.id}`,
      kind: 'prompt' as const,
      label: item.prompt,
      insertText: item.prompt,
      secondaryText: item.groupName ?? undefined,
      usageCount: item.usageCount,
    })),
    ...characters.map((item) => ({
      id: `character:${item.tagId}`,
      kind: 'character' as const,
      label: item.displayName,
      insertText: formatDanbooruTagForPrompt(item.name, tagUnderscores),
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
      insertText: formatDanbooruTagForPrompt(item.name, tagUnderscores),
      translatedName: item.translatedName,
      secondaryText: 'Danbooru tag',
      usageCount: item.usageCount,
    })),
  ]

  // 정확히 일치 > 앞부분 일치 > 포함 순서. 같은 단계에서는 지금 프롬프트와 자주 함께 쓴 것, 내 프롬프트, 사용량 순
  const normalizedQuery = normalizeAutocompleteLookup(query)
  const seen = new Set<string>()
  return suggestions
    .filter((suggestion) => {
      const key = normalizeAutocompleteLookup(suggestion.insertText)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .map((suggestion) => ({
      suggestion: { ...suggestion, relatedCount: relatedCountByTerm.get(normalizeAutocompleteLookup(suggestion.insertText)) },
      tier: getAutocompleteMatchTier(suggestion, normalizedQuery),
    }))
    .sort((left, right) => (
      right.tier - left.tier
      || (right.suggestion.relatedCount ?? 0) - (left.suggestion.relatedCount ?? 0)
      || Number(right.suggestion.kind === 'prompt') - Number(left.suggestion.kind === 'prompt')
      || getAutocompleteUsageCount(right.suggestion) - getAutocompleteUsageCount(left.suggestion)
    ))
    .slice(0, PROMPT_AUTOCOMPLETE_LIST_SIZE)
    .map(({ suggestion }) => suggestion)
}

/** Finished terms of the prompt outside the segment being typed, newest last (context for "used together"). */
function resolvePromptContextTerms(value: string, activeQuery: PromptAutocompleteQuery | null, limit = 3) {
  const before = activeQuery ? value.slice(0, activeQuery.start) : value
  const after = activeQuery ? value.slice(activeQuery.end) : ''
  return `${before},${after}`
    .split(/[,\n\r]/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !/__|\+\+|[<>()[\]{}@]/.test(term))
    .slice(-limit)
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

export function formatPromptAutocompleteCount(count: number | undefined) {
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
  isFocused,
  disabled,
  isWildcardPopupOpen,
  autocompletePromptType,
  tagUnderscores,
}: {
  value: string
  caretPosition: number
  isFocused: boolean
  disabled: boolean
  isWildcardPopupOpen: boolean
  autocompletePromptType: PromptTypeFilter
  /** Insert Danbooru tags with underscores instead of spaces. */
  tagUnderscores: boolean
}) {
  const [selectedCharacter, setSelectedCharacter] = useState<PromptAutocompleteSuggestion | null>(null)
  const activeQuery = useMemo(() => resolveActivePromptTextQuery(value, caretPosition), [caretPosition, value])
  const liveSearchText = activeQuery?.query.trim() ?? ''
  const liveContextKey = useMemo(() => resolvePromptContextTerms(value, activeQuery).join(','), [activeQuery, value])
  const [request, setRequest] = useState({ searchText: liveSearchText, contextKey: liveContextKey })
  const searchText = request.searchText
  const isOpen = isFocused && !disabled && !isWildcardPopupOpen && activeQuery !== null

  // 글자마다 요청하지 않도록 잠깐 모았다가 검색
  useEffect(() => {
    const timer = window.setTimeout(() => setRequest({ searchText: liveSearchText, contextKey: liveContextKey }), PROMPT_AUTOCOMPLETE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [liveContextKey, liveSearchText])

  // 내 프롬프트·단부루 태그·캐릭터·함께 쓴 태그를 한 번의 요청으로 받는다
  const suggestQuery = useQuery({
    queryKey: ['prompt-inline-autocomplete', autocompletePromptType, request.searchText, request.contextKey],
    queryFn: ({ signal }) => getPromptSuggestions({
      query: request.searchText,
      type: autocompletePromptType,
      limit: PROMPT_AUTOCOMPLETE_LIST_SIZE * 2,
      relatedTagLimit: PROMPT_AUTOCOMPLETE_RELATED_TAG_LIMIT,
      context: request.contextKey ? request.contextKey.split(',') : [],
    }, signal),
    enabled: isOpen && request.searchText.length > 0,
    staleTime: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
  })
  const suggestions = useMemo(
    () => buildPromptAutocompleteSuggestions({
      query: searchText,
      prompts: suggestQuery.data?.prompts ?? [],
      tags: suggestQuery.data?.tags ?? [],
      characters: suggestQuery.data?.characters ?? [],
      related: suggestQuery.data?.related ?? [],
      tagUnderscores,
    }),
    [searchText, suggestQuery.data, tagUnderscores],
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
  const isLoading = suggestQuery.isLoading

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
