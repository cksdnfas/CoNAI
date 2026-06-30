import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type SyntheticEvent, type UIEvent } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { inputVariants } from '@/components/ui/input'
import { textareaVariants } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { getDanbooruBrowserCharacters } from '@/lib/api-danbooru-browser'
import { cn } from '@/lib/utils'
import type { PromptTypeFilter } from '@/types/prompt'
import {
  getWildcardPromptSyntax,
  type WildcardWorkspaceTab,
} from './wildcard-generation-panel-helpers'
import {
  buildWildcardInsertion,
  MAX_RECENT_WILDCARDS,
  readStoredRecentWildcards,
  readStoredWildcardFilterMode,
  writeStoredRecentWildcards,
  type PromptWildcardTool,
  type WildcardFilterMode,
  type WildcardInsertionRange,
} from './wildcard-inline-picker-helpers'
import {
  detectPromptSyntaxTokens,
  getPromptSyntaxKindLabel,
  summarizePromptSyntaxTokens,
} from './prompt-syntax-highlight-helpers'
import { useWildcardInlinePickerData } from './use-wildcard-inline-picker-data'
import { resolveFloatingDropdownRectFromRect } from './floating-dropdown-utils'
import {
  buildPromptAutocompleteInsertion,
  normalizeAutocompleteText,
  resolvePromptDetectedCharacterCandidates,
  usePromptInlineAutocomplete,
  type PromptAutocompleteSuggestion,
} from './use-prompt-inline-autocomplete'
import { usePromptInlineSyntaxSettings } from './prompt-inline-syntax-settings'
import { useWildcardInlinePickerSuggestions } from './use-wildcard-inline-picker-suggestions'
import { WildcardInlinePickerPopupContent } from './wildcard-inline-picker-popup-content'
import {
  getPromptSyntaxChipClass,
  getTextFieldCaretClientRect,
  PromptAutocompletePopup,
  PromptSyntaxTokenPopup,
  renderPromptSyntaxOverlay,
  WildcardInlinePickerPopup,
  type InlinePickerPopupPosition,
  type PromptSyntaxPopupPosition,
} from './wildcard-inline-picker-field-ui'

type WildcardInlinePickerFieldProps = {
  value: string
  onChange: (value: string) => void
  tool: PromptWildcardTool
  multiline?: boolean
  rows?: number
  placeholder?: string
  disabled?: boolean
  className?: string
  showDetectedSyntax?: boolean
  autocompletePromptType?: PromptTypeFilter
}

/** Shared prompt-like text field with ++ wildcard autocomplete for NAI and ComfyUI. */
export function WildcardInlinePickerField({
  value,
  onChange,
  tool,
  multiline = false,
  rows = 4,
  placeholder,
  disabled = false,
  className,
  showDetectedSyntax = true,
  autocompletePromptType = 'positive',
}: WildcardInlinePickerFieldProps) {
  const { t } = useI18n()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const detectedPopupCloseTimerRef = useRef<number | null>(null)
  const detectedPopupRef = useRef<HTMLDivElement | null>(null)
  const detectedTokenButtonRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const detectedCharacterButtonRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const [caretPosition, setCaretPosition] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [isFocused, setIsFocused] = useState(false)
  const [filterMode, setFilterMode] = useState<WildcardFilterMode>(() => readStoredWildcardFilterMode(tool))
  const [recentWildcardNames, setRecentWildcardNames] = useState<string[]>(() => readStoredRecentWildcards(tool))
  const [activeExplorerTab, setActiveExplorerTab] = useState<WildcardWorkspaceTab>('wildcards')
  const [expandedExplorerIds, setExpandedExplorerIds] = useState<number[]>([])
  const [isExplorerPinned, setIsExplorerPinned] = useState(false)
  const [fieldScrollTop, setFieldScrollTop] = useState(0)
  const [fieldScrollLeft, setFieldScrollLeft] = useState(0)
  const [activeDetectedTokenKey, setActiveDetectedTokenKey] = useState<string | null>(null)
  const [activeDetectedCharacterKey, setActiveDetectedCharacterKey] = useState<string | null>(null)
  const [detectedPopupPosition, setDetectedPopupPosition] = useState<PromptSyntaxPopupPosition | null>(null)
  const [detectedCharacterPopupPosition, setDetectedCharacterPopupPosition] = useState<InlinePickerPopupPosition | null>(null)
  const [inlinePopupPosition, setInlinePopupPosition] = useState<InlinePickerPopupPosition | null>(null)
  const [promptAutocompletePopupPosition, setPromptAutocompletePopupPosition] = useState<InlinePickerPopupPosition | null>(null)
  const { settings: syntaxSettings } = usePromptInlineSyntaxSettings()
  const shouldLoadWildcardData = !disabled && isFocused

  const {
    wildcardsQuery,
    flattenedWildcards,
    explorerTreeNodes,
    explorerEntries,
    selectedExplorerId,
    setSelectedExplorerId,
    explorerEntryIdSet,
    rootExplorerEntryIds,
  } = useWildcardInlinePickerData({
    activeTab: activeExplorerTab,
    enabled: shouldLoadWildcardData,
  })
  const {
    activeGroupQuery,
    activeWildcardQuery,
    activeSource,
    activeQuery,
    activePreprocessQuery,
    activeDanbooruGroupQuery,
    danbooruSummaryQuery,
    preprocessSuggestions,
    groupSuggestions,
    suggestions,
    normalizedActiveQuery,
    indexedSuggestions,
    recentSuggestions,
    remainingSuggestions,
  } = useWildcardInlinePickerSuggestions({
    value,
    caretPosition,
    syntaxSettings,
    flattenedWildcards,
    filterMode,
    recentWildcardNames,
    tool,
  })
  const detectedTokens = useMemo(
    () => detectPromptSyntaxTokens(value, flattenedWildcards, tool),
    [flattenedWildcards, tool, value],
  )
  const detectedTokenSummaries = useMemo(
    () => summarizePromptSyntaxTokens(detectedTokens),
    [detectedTokens],
  )
  const activeDetectedToken = useMemo(
    () => detectedTokenSummaries.find((token) => token.key === activeDetectedTokenKey) ?? null,
    [activeDetectedTokenKey, detectedTokenSummaries],
  )
  const detectedCharacterCandidates = useMemo(
    () => (syntaxSettings.characterRelatedTags ? resolvePromptDetectedCharacterCandidates(value) : []),
    [syntaxSettings.characterRelatedTags, value],
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
  const detectedCharacters = useMemo(() => detectedCharacterCandidates.flatMap((candidate, index) => {
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
  const activeDetectedCharacter = useMemo(
    () => detectedCharacters.find((character) => character.candidate.key === activeDetectedCharacterKey) ?? null,
    [activeDetectedCharacterKey, detectedCharacters],
  )

  const isTreeExplorerMode = activeSource === 'wildcard' && filterMode === 'all' && (activeQuery === null || (activeQuery?.query.trim().length ?? 0) === 0)
  const isPopupOpen = isFocused && !disabled && (activeSource === 'danbooru-group' || activeSource === 'preprocess' || activeSource === 'wildcard' || isExplorerPinned)
  const {
    activeQuery: activePromptAutocompleteQuery,
    isOpen: isPromptAutocompleteOpen,
    suggestions: promptAutocompleteSuggestions,
    activeCharacter: activePromptAutocompleteCharacter,
    isLoading: isPromptAutocompleteLoading,
    setSelectedCharacter: setSelectedPromptAutocompleteCharacter,
  } = usePromptInlineAutocomplete({
    value,
    caretPosition,
    activeWildcardQuery: activeSource === 'tag' ? null : (activeWildcardQuery ?? activeGroupQuery),
    isExplorerPinned,
    isFocused,
    disabled: disabled || activeSource !== 'tag',
    isWildcardPopupOpen: isPopupOpen,
    autocompletePromptType,
  })
  useLayoutEffect(() => {
    if (!multiline || !(fieldRef.current instanceof HTMLTextAreaElement)) {
      return
    }

    const field = fieldRef.current
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [multiline, rows, value])

  useEffect(() => {
    setActiveIndex(0)
  }, [activeDanbooruGroupQuery?.query, activePreprocessQuery?.query, activeQuery?.query, activeSource, filterMode, tool])

  useEffect(() => {
    setFilterMode(readStoredWildcardFilterMode(tool))
    setRecentWildcardNames(readStoredRecentWildcards(tool))
  }, [tool])

  useEffect(() => {
    if (rootExplorerEntryIds.length === 0) {
      return
    }

    if (selectedExplorerId === null || !explorerEntryIdSet.has(selectedExplorerId)) {
      setExpandedExplorerIds((current) => Array.from(new Set([...current, ...rootExplorerEntryIds])))
    }
  }, [explorerEntryIdSet, rootExplorerEntryIds, selectedExplorerId])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
    }
    if (detectedPopupCloseTimerRef.current !== null) {
      window.clearTimeout(detectedPopupCloseTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!activeDetectedTokenKey || typeof window === 'undefined') {
      setDetectedPopupPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = detectedTokenButtonRefs.current.get(activeDetectedTokenKey)
      if (!anchor) {
        setDetectedPopupPosition(null)
        return
      }

      const rect = anchor.getBoundingClientRect()
      const viewportPadding = 12
      const popupGap = 8
      const popupWidth = Math.min(300, window.innerWidth - viewportPadding * 2)
      const estimatedPopupHeight = 112
      const shouldOpenAbove = rect.bottom + popupGap + estimatedPopupHeight > window.innerHeight - viewportPadding && rect.top > estimatedPopupHeight + popupGap

      let left = rect.left + rect.width / 2 - popupWidth / 2
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - viewportPadding - popupWidth))

      setDetectedPopupPosition({
        top: shouldOpenAbove ? rect.top - popupGap : rect.bottom + popupGap,
        left,
        width: popupWidth,
        placement: shouldOpenAbove ? 'top' : 'bottom',
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [activeDetectedTokenKey])

  useEffect(() => {
    if (activeDetectedCharacterKey && !detectedCharacters.some((character) => character.candidate.key === activeDetectedCharacterKey)) {
      setActiveDetectedCharacterKey(null)
    }
  }, [activeDetectedCharacterKey, detectedCharacters])

  useEffect(() => {
    if (!activeDetectedCharacter || typeof window === 'undefined') {
      setDetectedCharacterPopupPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = detectedCharacterButtonRefs.current.get(activeDetectedCharacter.candidate.key)
      if (!anchor) {
        setDetectedCharacterPopupPosition(null)
        return
      }

      setDetectedCharacterPopupPosition(resolveFloatingDropdownRectFromRect(anchor.getBoundingClientRect(), {
        minWidth: 280,
        preferredMaxHeight: 220,
        minUsableHeight: 120,
        gap: 8,
      }))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [activeDetectedCharacter])

  useEffect(() => {
    if (!isPopupOpen || typeof window === 'undefined') {
      setInlinePopupPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = rootRef.current
      const field = fieldRef.current
      if (!anchor || !field) {
        setInlinePopupPosition(null)
        return
      }

      const fieldRect = field.getBoundingClientRect()
      const caretRect = getTextFieldCaretClientRect(field, caretPosition)
      const popupAnchorRect = caretRect
        ? {
            left: fieldRect.left,
            top: caretRect.top,
            bottom: caretRect.bottom,
            width: fieldRect.width,
          }
        : fieldRect

      setInlinePopupPosition(resolveFloatingDropdownRectFromRect(popupAnchorRect, {
        minWidth: fieldRect.width,
        preferredMaxHeight: 420,
        minUsableHeight: 220,
        gap: 8,
      }))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [caretPosition, fieldScrollLeft, fieldScrollTop, isPopupOpen, isTreeExplorerMode, suggestions.length, value])

  useEffect(() => {
    if (!isPromptAutocompleteOpen || typeof window === 'undefined') {
      setPromptAutocompletePopupPosition(null)
      return
    }

    const updatePosition = () => {
      const field = fieldRef.current
      if (!field) {
        setPromptAutocompletePopupPosition(null)
        return
      }

      const fieldRect = field.getBoundingClientRect()
      const caretRect = getTextFieldCaretClientRect(field, caretPosition)
      const popupAnchorRect = caretRect
        ? {
            left: fieldRect.left,
            top: caretRect.top,
            bottom: caretRect.bottom,
            width: fieldRect.width,
          }
        : fieldRect

      setPromptAutocompletePopupPosition(resolveFloatingDropdownRectFromRect(popupAnchorRect, {
        minWidth: Math.min(Math.max(fieldRect.width * 0.55, 240), 420),
        preferredMaxHeight: 180,
        minUsableHeight: 96,
        gap: 10,
      }))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [caretPosition, fieldScrollLeft, fieldScrollTop, isPromptAutocompleteOpen, promptAutocompleteSuggestions.length, value])

  useEffect(() => {
    if (!activeDetectedTokenKey || typeof document === 'undefined') {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const popupNode = detectedPopupRef.current
      const anchor = detectedTokenButtonRefs.current.get(activeDetectedTokenKey)
      const target = event.target as Node | null

      if ((popupNode && target && popupNode.contains(target)) || (anchor && target && anchor.contains(target))) {
        return
      }

      setActiveDetectedTokenKey(null)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [activeDetectedTokenKey])

  const syncCaretPosition = (element: HTMLInputElement | HTMLTextAreaElement) => {
    setCaretPosition(element.selectionStart ?? element.value.length)
    setFieldScrollTop(element.scrollTop)
    setFieldScrollLeft(element.scrollLeft)
  }

  const syncCaretPositionAfterSelection = (element: HTMLInputElement | HTMLTextAreaElement, clearSelectedCharacter = false) => {
    window.requestAnimationFrame(() => {
      syncCaretPosition(element)
      if (clearSelectedCharacter) {
        setSelectedPromptAutocompleteCharacter(null)
      }
    })
  }

  const handleChangeValue = (nextValue: string, element: HTMLInputElement | HTMLTextAreaElement) => {
    onChange(nextValue)
    syncCaretPosition(element)
    setSelectedPromptAutocompleteCharacter(null)

    if (activeQuery === null && isExplorerPinned) {
      setIsExplorerPinned(false)
    }
  }

  const handleInsertWildcard = (wildcardName: string, explicitSyntaxText?: string) => {
    if (!fieldRef.current) {
      return
    }

    const insertionRange: WildcardInsertionRange | null = activeQuery
      ? { start: activeQuery.start, end: activeQuery.end }
      : isExplorerPinned
        ? { start: caretPosition, end: caretPosition }
        : null

    if (!insertionRange) {
      return
    }

    const insertionText = explicitSyntaxText ?? getWildcardPromptSyntax(wildcardName)
    const { nextValue, nextCaretPosition } = buildWildcardInsertion(value, insertionText, insertionRange)
    const nextRecentWildcardNames = [wildcardName, ...recentWildcardNames.filter((name) => name !== wildcardName)].slice(0, MAX_RECENT_WILDCARDS)

    onChange(nextValue)
    setCaretPosition(nextCaretPosition)
    setActiveIndex(0)
    setIsExplorerPinned(filterMode === 'all')
    setRecentWildcardNames(nextRecentWildcardNames)
    writeStoredRecentWildcards(tool, nextRecentWildcardNames)

    window.requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }

  const handleInsertPreprocess = (preprocessName: string) => {
    if (!fieldRef.current || !activePreprocessQuery) {
      return
    }

    const { nextValue, nextCaretPosition } = buildPromptAutocompleteInsertion(value, preprocessName, activePreprocessQuery)

    onChange(nextValue)
    setCaretPosition(nextCaretPosition)
    setActiveIndex(0)

    window.requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }

  const handleInsertDanbooruGroup = (groupName: string) => {
    if (!fieldRef.current || !activeDanbooruGroupQuery) {
      return
    }

    const { nextValue, nextCaretPosition } = buildPromptAutocompleteInsertion(value, `__${groupName}__`, activeDanbooruGroupQuery)

    onChange(nextValue)
    setCaretPosition(nextCaretPosition)
    setActiveIndex(0)

    window.requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }

  const handleInsertPromptAutocomplete = (suggestion: PromptAutocompleteSuggestion) => {
    if (!fieldRef.current || !activePromptAutocompleteQuery) {
      return
    }

    const { nextValue, nextCaretPosition } = buildPromptAutocompleteInsertion(value, suggestion.insertText, activePromptAutocompleteQuery)

    onChange(nextValue)
    setCaretPosition(nextCaretPosition)
    setSelectedPromptAutocompleteCharacter(suggestion.kind === 'character' ? suggestion : null)

    window.requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }

  const handleInsertPromptRelatedTag = (tagName: string) => {
    if (!fieldRef.current || !activePromptAutocompleteQuery) {
      return
    }

    const { nextValue, nextCaretPosition } = buildPromptAutocompleteInsertion(value, tagName, activePromptAutocompleteQuery, 'append')

    onChange(nextValue)
    setCaretPosition(nextCaretPosition)

    window.requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }

  const handleInsertDetectedCharacterRelatedTag = (tagName: string) => {
    if (!fieldRef.current || !activeDetectedCharacter) {
      return
    }

    const { nextValue, nextCaretPosition } = buildPromptAutocompleteInsertion(value, tagName, activeDetectedCharacter.candidate, 'append')

    onChange(nextValue)
    setCaretPosition(nextCaretPosition)
    setActiveDetectedCharacterKey(null)

    window.requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (isPopupOpen && activeSource === 'danbooru-group' && groupSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((current) => (current + 1) % groupSuggestions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((current) => (current - 1 + groupSuggestions.length) % groupSuggestions.length)
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        handleInsertDanbooruGroup(groupSuggestions[activeIndex]?.label ?? groupSuggestions[0].label)
        return
      }
    }

    if (isPopupOpen && activeSource === 'preprocess' && preprocessSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((current) => (current + 1) % preprocessSuggestions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((current) => (current - 1 + preprocessSuggestions.length) % preprocessSuggestions.length)
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        handleInsertPreprocess(preprocessSuggestions[activeIndex]?.record.name ?? preprocessSuggestions[0].record.name)
        return
      }
    }

    if (isPopupOpen && activeSource === 'wildcard' && !isTreeExplorerMode && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((current) => (current + 1) % suggestions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length)
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        handleInsertWildcard(suggestions[activeIndex]?.record.name ?? suggestions[0].record.name)
        return
      }
    }

    if (isPromptAutocompleteOpen && event.key === 'Escape') {
      event.preventDefault()
      setCaretPosition(-1)
      setSelectedPromptAutocompleteCharacter(null)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setCaretPosition(-1)
      setIsExplorerPinned(false)
    }
  }

  const sharedProps = {
    value,
    placeholder,
    disabled,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChangeValue(event.target.value, event.target),
    onKeyDown: handleKeyDown,
    onKeyUp: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const isNavigationKey = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)
      syncCaretPositionAfterSelection(event.currentTarget, isNavigationKey)
    },
    onClick: (event: MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => syncCaretPositionAfterSelection(event.currentTarget, true),
    onMouseUp: (event: MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => syncCaretPositionAfterSelection(event.currentTarget, true),
    onSelect: (event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => syncCaretPositionAfterSelection(event.currentTarget, true),
    onScroll: (event: UIEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFieldScrollTop(event.currentTarget.scrollTop)
      setFieldScrollLeft(event.currentTarget.scrollLeft)
    },
    onFocus: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
      setIsFocused(true)
      syncCaretPosition(event.currentTarget)
    },
    onBlur: () => {
      closeTimerRef.current = window.setTimeout(() => {
        setIsFocused(false)
        setIsExplorerPinned(false)
      }, 120)
    },
  }

  const toggleExplorerExpanded = (wildcardId: number) => {
    setExpandedExplorerIds((current) => (
      current.includes(wildcardId)
        ? current.filter((id) => id !== wildcardId)
        : [...current, wildcardId]
    ))
  }

  const cancelDetectedPopupClose = () => {
    if (detectedPopupCloseTimerRef.current !== null) {
      window.clearTimeout(detectedPopupCloseTimerRef.current)
      detectedPopupCloseTimerRef.current = null
    }
  }

  const scheduleDetectedPopupClose = () => {
    cancelDetectedPopupClose()
    detectedPopupCloseTimerRef.current = window.setTimeout(() => {
      setActiveDetectedTokenKey(null)
    }, 120)
  }

  return (
    <div ref={rootRef} className="relative space-y-2">
      <div className={cn('relative rounded-sm', showDetectedSyntax && detectedTokens.length > 0 ? 'bg-surface-container' : undefined)}>
        {showDetectedSyntax && detectedTokens.length > 0 ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm">
            {multiline ? (
              <div
                className="absolute inset-0 whitespace-pre-wrap break-words px-3 py-2 text-sm text-transparent"
                style={{ transform: `translate(${-fieldScrollLeft}px, ${-fieldScrollTop}px)` }}
              >
                {renderPromptSyntaxOverlay(value, detectedTokens)}
              </div>
            ) : (
              <div className="flex h-full items-center overflow-hidden px-3 text-sm text-transparent">
                <div
                  className="min-w-full whitespace-pre"
                  style={{ transform: `translateX(${-fieldScrollLeft}px)` }}
                >
                  {renderPromptSyntaxOverlay(value, detectedTokens)}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {multiline ? (
          <textarea
            ref={(node) => {
              fieldRef.current = node
            }}
            rows={rows}
            {...sharedProps}
            className={cn(textareaVariants(), 'overflow-hidden', showDetectedSyntax && detectedTokens.length > 0 ? 'relative z-10 bg-transparent' : 'relative z-10', className)}
          />
        ) : (
          <input
            ref={(node) => {
              fieldRef.current = node
            }}
            type="text"
            {...sharedProps}
            className={cn(inputVariants(), showDetectedSyntax && detectedTokens.length > 0 ? 'relative z-10 bg-transparent' : 'relative z-10', className)}
          />
        )}
      </div>

      {showDetectedSyntax && detectedTokenSummaries.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-[11px] text-muted-foreground">
          <span>{t('image-generation.components.wildcard.inline.picker.field.detected')}</span>
          {detectedTokenSummaries.map((token) => {
            const isActive = token.key === activeDetectedTokenKey
            return (
              <button
                key={token.key}
                ref={(node) => {
                  detectedTokenButtonRefs.current.set(token.key, node)
                }}
                type="button"
                className={getPromptSyntaxChipClass(token.kind, isActive)}
                onMouseEnter={() => {
                  cancelDetectedPopupClose()
                  setActiveDetectedTokenKey(token.key)
                }}
                onMouseLeave={() => {
                  scheduleDetectedPopupClose()
                }}
                onFocus={() => {
                  cancelDetectedPopupClose()
                  setActiveDetectedTokenKey(token.key)
                }}
                onBlur={() => {
                  scheduleDetectedPopupClose()
                }}
                onClick={() => {
                  cancelDetectedPopupClose()
                  setActiveDetectedTokenKey((current) => current === token.key ? null : token.key)
                }}
              >
                <span className="max-w-[12rem] truncate">{token.kind === 'comment' ? t('image-generation.components.wildcard.inline.picker.field.comment.items', { count: token.count }) : token.rawText}</span>
                <span className="text-muted-foreground">{getPromptSyntaxKindLabel(token.kind)}</span>
                {token.count > 1 ? <Badge variant="secondary">{token.count}</Badge> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {showDetectedSyntax && detectedCharacters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-[11px] text-muted-foreground">
          <span>{t({ ko: '캐릭터', en: 'Characters' })}</span>
          {detectedCharacters.map(({ candidate, suggestion }) => {
            const isActive = candidate.key === activeDetectedCharacterKey
            return (
              <button
                key={candidate.key}
                ref={(node) => {
                  detectedCharacterButtonRefs.current.set(candidate.key, node)
                }}
                type="button"
                className={cn(
                  'inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors',
                  isActive ? 'border-cyan-300/60 bg-cyan-400/18 text-foreground' : 'border-cyan-400/20 bg-cyan-400/10 text-foreground/90 hover:bg-cyan-400/16',
                )}
                onClick={() => {
                  setActiveDetectedCharacterKey((current) => current === candidate.key ? null : candidate.key)
                }}
              >
                <span className="max-w-[12rem] truncate">{suggestion.label}</span>
                {suggestion.translatedName ? <span className="max-w-[8rem] truncate text-muted-foreground">{suggestion.translatedName}</span> : null}
                {suggestion.relatedTags?.length ? <Badge variant="secondary">{suggestion.relatedTags.length}</Badge> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {showDetectedSyntax && activeDetectedToken && detectedPopupPosition ? (
        <PromptSyntaxTokenPopup
          token={activeDetectedToken}
          position={detectedPopupPosition}
          popupRef={detectedPopupRef}
          onMouseEnter={() => {
            cancelDetectedPopupClose()
          }}
          onMouseLeave={() => {
            scheduleDetectedPopupClose()
          }}
        />
      ) : null}

      {showDetectedSyntax && activeDetectedCharacter && detectedCharacterPopupPosition ? (
        <PromptAutocompletePopup
          position={detectedCharacterPopupPosition}
          suggestions={[]}
          activeCharacter={activeDetectedCharacter.suggestion}
          isLoading={false}
          onSelect={() => undefined}
          onSelectRelatedTag={handleInsertDetectedCharacterRelatedTag}
        />
      ) : null}

      {isPromptAutocompleteOpen && promptAutocompletePopupPosition ? (
        <PromptAutocompletePopup
          position={promptAutocompletePopupPosition}
          suggestions={promptAutocompleteSuggestions}
          activeCharacter={activePromptAutocompleteCharacter}
          isLoading={isPromptAutocompleteLoading}
          onSelect={handleInsertPromptAutocomplete}
          onSelectRelatedTag={handleInsertPromptRelatedTag}
        />
      ) : null}

      {isPopupOpen && inlinePopupPosition ? (
        <WildcardInlinePickerPopup position={inlinePopupPosition}>
          <WildcardInlinePickerPopupContent
            activeSource={activeSource}
            activeIndex={activeIndex}
            activeListSuggestions={indexedSuggestions}
            activeExplorerTab={activeExplorerTab}
            expandedExplorerIds={expandedExplorerIds}
            explorerEntriesCount={explorerEntries.length}
            explorerTreeNodes={explorerTreeNodes}
            filterMode={filterMode}
            groupSuggestions={groupSuggestions}
            isDanbooruDatabaseAvailable={danbooruSummaryQuery.data?.database.available !== false}
            isDanbooruSummaryLoading={danbooruSummaryQuery.isLoading}
            isTreeExplorerMode={isTreeExplorerMode}
            isWildcardsLoading={wildcardsQuery.isLoading}
            normalizedActiveQuery={normalizedActiveQuery}
            recentSuggestions={recentSuggestions}
            remainingSuggestions={remainingSuggestions}
            selectedExplorerId={selectedExplorerId}
            tool={tool}
            onChangeActiveExplorerTab={setActiveExplorerTab}
            onChangeFilterMode={setFilterMode}
            onInsertDanbooruGroup={handleInsertDanbooruGroup}
            onInsertPreprocess={handleInsertPreprocess}
            onInsertWildcard={handleInsertWildcard}
            onSelectExplorerId={setSelectedExplorerId}
            onSetExplorerPinned={setIsExplorerPinned}
            onToggleExplorerExpanded={toggleExplorerExpanded}
          />
        </WildcardInlinePickerPopup>
      ) : null}
    </div>
  )
}
