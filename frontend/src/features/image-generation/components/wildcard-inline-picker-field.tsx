import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type SyntheticEvent, type UIEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { inputVariants } from '@/components/ui/input'
import { textareaVariants } from '@/components/ui/textarea'
import { getWildcards } from '@/lib/api-wildcards'
import { cn } from '@/lib/utils'
import type { PromptTypeFilter } from '@/types/prompt'
import {
  getWildcardPromptSyntax,
  type WildcardWorkspaceTab,
} from './wildcard-generation-panel-helpers'
import {
  buildWildcardInsertion,
  countStoredWildcardItemsForTool,
  countWildcardItemsForTool,
  flattenWildcardRecords,
  MAX_RECENT_WILDCARDS,
  readStoredRecentWildcards,
  readStoredWildcardFilterMode,
  resolveActiveWildcardQuery,
  scoreWildcardMatch,
  writeStoredRecentWildcards,
  writeStoredWildcardFilterMode,
  resolvePreferredWildcardItemTool,
  type FlattenedWildcardRecord,
  type PromptWildcardTool,
  type WildcardFilterMode,
  type WildcardInsertionRange,
} from './wildcard-inline-picker-helpers'
import {
  detectPromptSyntaxTokens,
  getPromptSyntaxKindLabel,
  summarizePromptSyntaxTokens,
} from './prompt-syntax-highlight-helpers'
import { useWildcardWorkspaceBrowser } from './use-wildcard-workspace-browser'
import { WildcardInlinePickerExplorer } from './wildcard-inline-picker-explorer'
import { resolveFloatingDropdownRectFromRect } from './floating-dropdown-utils'
import {
  buildPromptAutocompleteInsertion,
  usePromptInlineAutocomplete,
  type PromptAutocompleteSuggestion,
} from './use-prompt-inline-autocomplete'
import {
  getPromptSyntaxChipClass,
  getTextFieldCaretClientRect,
  PromptAutocompletePopup,
  PromptSyntaxTokenPopup,
  renderHighlightedText,
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
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const detectedPopupCloseTimerRef = useRef<number | null>(null)
  const detectedPopupRef = useRef<HTMLDivElement | null>(null)
  const detectedTokenButtonRefs = useRef(new Map<string, HTMLButtonElement | null>())
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
  const [detectedPopupPosition, setDetectedPopupPosition] = useState<PromptSyntaxPopupPosition | null>(null)
  const [inlinePopupPosition, setInlinePopupPosition] = useState<InlinePickerPopupPosition | null>(null)
  const [promptAutocompletePopupPosition, setPromptAutocompletePopupPosition] = useState<InlinePickerPopupPosition | null>(null)

  const wildcardsQuery = useQuery({
    queryKey: ['wildcards', 'inline-picker'],
    queryFn: () => getWildcards({ hierarchical: true, withItems: true }),
    staleTime: 60_000,
  })

  const wildcards = useMemo(() => wildcardsQuery.data ?? [], [wildcardsQuery.data])
  const flattenedWildcards = useMemo(() => flattenWildcardRecords(wildcards), [wildcards])
  const activeQuery = useMemo(() => resolveActiveWildcardQuery(value, caretPosition), [value, caretPosition])
  const {
    treeNodes: explorerTreeNodes,
    entries: explorerEntries,
    selectedWildcardId: selectedExplorerId,
    setSelectedWildcardId: setSelectedExplorerId,
  } = useWildcardWorkspaceBrowser({
    records: wildcards,
    activeTab: activeExplorerTab,
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

  const suggestions = useMemo(() => {
    if (!activeQuery) {
      return []
    }

    const normalizedQuery = activeQuery.query.trim().toLowerCase()
    const recentIndexMap = new Map(recentWildcardNames.map((name, index) => [name, index]))
    const records = flattenedWildcards
      .map((record) => ({
        record,
        score: scoreWildcardMatch(record, normalizedQuery),
        toolItemCount: countWildcardItemsForTool(record.items, tool),
        generalItemCount: countStoredWildcardItemsForTool(record.items, 'general'),
        naiItemCount: countStoredWildcardItemsForTool(record.items, 'nai'),
        comfyuiItemCount: countStoredWildcardItemsForTool(record.items, 'comfyui'),
        recentIndex: recentIndexMap.get(record.name) ?? Number.POSITIVE_INFINITY,
      }))
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

    return records
  }, [activeQuery, filterMode, flattenedWildcards, recentWildcardNames, tool])

  const isTreeExplorerMode = filterMode === 'all' && (activeQuery === null || (activeQuery?.query.trim().length ?? 0) === 0)
  const isPopupOpen = isFocused && (activeQuery !== null || isExplorerPinned) && !disabled
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
    activeWildcardQuery: activeQuery,
    isExplorerPinned,
    isFocused,
    disabled,
    isWildcardPopupOpen: isPopupOpen,
    autocompletePromptType,
  })
  const normalizedActiveQuery = activeQuery?.query.trim() ?? ''
  const indexedSuggestions = suggestions.map((suggestion, index) => ({ ...suggestion, index }))
  const recentSuggestions = normalizedActiveQuery.length === 0
    ? indexedSuggestions.filter((suggestion) => Number.isFinite(suggestion.recentIndex))
    : []
  const remainingSuggestions = normalizedActiveQuery.length === 0
    ? indexedSuggestions.filter((suggestion) => !Number.isFinite(suggestion.recentIndex))
    : indexedSuggestions

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
  }, [activeQuery?.query, filterMode, tool])

  useEffect(() => {
    setFilterMode(readStoredWildcardFilterMode(tool))
    setRecentWildcardNames(readStoredRecentWildcards(tool))
  }, [tool])

  useEffect(() => {
    if (explorerEntries.length === 0) {
      return
    }

    if (selectedExplorerId === null || !explorerEntries.some((entry) => entry.wildcard.id === selectedExplorerId)) {
      setExpandedExplorerIds((current) => Array.from(new Set([...current, ...explorerEntries.filter((entry) => entry.depth === 0).map((entry) => entry.wildcard.id)])))
    }
  }, [explorerEntries, selectedExplorerId])

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

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (isPopupOpen && !isTreeExplorerMode && suggestions.length > 0) {
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

  const renderSuggestionButton = ({
    record,
    toolItemCount,
    generalItemCount,
    naiItemCount,
    comfyuiItemCount,
    recentIndex,
    index,
  }: {
    record: FlattenedWildcardRecord
    toolItemCount: number
    generalItemCount: number
    naiItemCount: number
    comfyuiItemCount: number
    recentIndex: number
    index: number
  }) => {
    const isActive = index === activeIndex
    const preferredBadgeTool = resolvePreferredWildcardItemTool(record.items, tool)

    return (
      <button
        key={record.id}
        type="button"
        onMouseDown={(event) => {
          event.preventDefault()
          handleInsertWildcard(record.name)
        }}
        className={cn(
          'flex w-full items-start justify-between gap-3 rounded-sm px-3 py-2 text-left transition-colors',
          isActive ? 'bg-surface-high' : 'hover:bg-surface-lowest',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{renderHighlightedText(record.name, normalizedActiveQuery)}</span>
            <Badge variant={record.type === 'chain' ? 'secondary' : 'outline'}>{record.type === 'chain' ? 'Chain' : 'Wildcard'}</Badge>
            {record.isAutoCollected ? <Badge variant="outline">Auto LoRA</Badge> : null}
            {Number.isFinite(recentIndex) ? <Badge variant="secondary">최근 사용</Badge> : null}
            {toolItemCount === 0 ? <Badge variant="outline">현재 툴 비어있음</Badge> : null}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{renderHighlightedText(record.path.join(' / '), normalizedActiveQuery)}</div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge variant={preferredBadgeTool === 'general' ? 'secondary' : 'outline'}>General {generalItemCount}</Badge>
          <Badge variant={preferredBadgeTool === 'nai' ? 'secondary' : 'outline'}>NAI {naiItemCount}</Badge>
          <Badge variant={preferredBadgeTool === 'comfyui' ? 'secondary' : 'outline'}>Comfy {comfyuiItemCount}</Badge>
        </div>
      </button>
    )
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
          <span>감지됨</span>
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
                <span className="max-w-[12rem] truncate">{token.kind === 'comment' ? `주석 ${token.count}개 항목` : token.rawText}</span>
                <span className="text-muted-foreground">{getPromptSyntaxKindLabel(token.kind)}</span>
                {token.count > 1 ? <Badge variant="secondary">{token.count}</Badge> : null}
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
          <div className="space-y-2 border-b border-border/70 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    setFilterMode('available-only')
                    setIsExplorerPinned(false)
                    writeStoredWildcardFilterMode(tool, 'available-only')
                  }}
                  className={cn(
                    'rounded-sm border px-2 py-1 text-xs transition-colors',
                    filterMode === 'available-only' ? 'border-primary bg-surface-high text-foreground' : 'border-border bg-surface-lowest hover:bg-surface-high',
                  )}
                >
                  검색
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    setFilterMode('all')
                    setIsExplorerPinned(true)
                    writeStoredWildcardFilterMode(tool, 'all')
                  }}
                  className={cn(
                    'rounded-sm border px-2 py-1 text-xs transition-colors',
                    filterMode === 'all' ? 'border-primary bg-surface-high text-foreground' : 'border-border bg-surface-lowest hover:bg-surface-high',
                  )}
                >
                  전체 보기
                </button>
              </div>
              <Badge variant="outline">{isTreeExplorerMode ? explorerEntries.length : suggestions.length}</Badge>
            </div>
          </div>

          {wildcardsQuery.isLoading ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">와일드카드 불러오는 중…</div>
          ) : isTreeExplorerMode ? (
            <WildcardInlinePickerExplorer
              activeTab={activeExplorerTab}
              expandedWildcardIds={expandedExplorerIds}
              selectedWildcardId={selectedExplorerId}
              tool={tool}
              treeNodes={explorerTreeNodes}
              onChangeActiveTab={setActiveExplorerTab}
              onInsertWildcard={handleInsertWildcard}
              onSelectWildcard={setSelectedExplorerId}
              onToggleExpanded={toggleExplorerExpanded}
            />
          ) : suggestions.length > 0 ? (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
              {recentSuggestions.length > 0 ? (
                <div className="space-y-1">
                  <div className="px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">최근 사용</div>
                  <div className="space-y-1">
                    {recentSuggestions.map(renderSuggestionButton)}
                  </div>
                </div>
              ) : null}

              {remainingSuggestions.length > 0 ? (
                <div className="space-y-1">
                  {recentSuggestions.length > 0 ? <div className="px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">전체 결과</div> : null}
                  <div className="space-y-1">
                    {remainingSuggestions.map(renderSuggestionButton)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2 px-3 py-3 text-sm text-muted-foreground">
              <div>검색되는 와일드카드가 없어.</div>
              {filterMode === 'available-only' ? <div className="text-xs">검색 모드에서는 다른 툴 전용 와일드카드가 숨겨질 수 있어.</div> : null}
            </div>
          )}
        </WildcardInlinePickerPopup>
      ) : null}
    </div>
  )
}
