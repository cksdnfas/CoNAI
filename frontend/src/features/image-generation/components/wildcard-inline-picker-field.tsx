import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { inputVariants } from '@/components/ui/input'
import { textareaVariants } from '@/components/ui/textarea'
import { getWildcards, type WildcardTool } from '@/lib/api'
import { cn } from '@/lib/utils'
import { filterWildcardTree, flattenWildcardTree, matchesWorkspaceTab, type WildcardWorkspaceTab } from './wildcard-generation-panel-helpers'
import {
  buildWildcardInsertion,
  countWildcardItemsForTool,
  flattenWildcardRecords,
  MAX_RECENT_WILDCARDS,
  readStoredRecentWildcards,
  readStoredWildcardFilterMode,
  resolveActiveWildcardQuery,
  scoreWildcardMatch,
  type FlattenedWildcardRecord,
  type WildcardFilterMode,
  type WildcardInsertionRange,
  writeStoredRecentWildcards,
  writeStoredWildcardFilterMode,
} from './wildcard-inline-picker-helpers'
import { WildcardInlinePickerExplorer } from './wildcard-inline-picker-explorer'

type WildcardInlinePickerFieldProps = {
  value: string
  onChange: (value: string) => void
  tool: WildcardTool
  multiline?: boolean
  rows?: number
  placeholder?: string
  disabled?: boolean
  className?: string
}

/** Highlight the first matched query segment inside one suggestion label. */
function renderHighlightedText(text: string, query: string) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return text
  }

  const lowerText = text.toLowerCase()
  const lowerQuery = normalizedQuery.toLowerCase()
  const matchIndex = lowerText.indexOf(lowerQuery)

  if (matchIndex < 0) {
    return text
  }

  const before = text.slice(0, matchIndex)
  const matched = text.slice(matchIndex, matchIndex + normalizedQuery.length)
  const after = text.slice(matchIndex + normalizedQuery.length)

  return (
    <>
      {before}
      <mark className="rounded-sm bg-primary/20 px-0.5 text-foreground">{matched}</mark>
      {after}
    </>
  )
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
}: WildcardInlinePickerFieldProps) {
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [caretPosition, setCaretPosition] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [isFocused, setIsFocused] = useState(false)
  const [filterMode, setFilterMode] = useState<WildcardFilterMode>(() => readStoredWildcardFilterMode(tool))
  const [recentWildcardNames, setRecentWildcardNames] = useState<string[]>(() => readStoredRecentWildcards(tool))
  const [activeExplorerTab, setActiveExplorerTab] = useState<WildcardWorkspaceTab>('wildcards')
  const [selectedExplorerId, setSelectedExplorerId] = useState<number | null>(null)
  const [expandedExplorerIds, setExpandedExplorerIds] = useState<number[]>([])
  const [isExplorerPinned, setIsExplorerPinned] = useState(false)

  const wildcardsQuery = useQuery({
    queryKey: ['wildcards', 'inline-picker'],
    queryFn: () => getWildcards({ hierarchical: true, withItems: true }),
    staleTime: 60_000,
  })

  const wildcards = wildcardsQuery.data ?? []
  const flattenedWildcards = useMemo(() => flattenWildcardRecords(wildcards), [wildcards])
  const activeQuery = useMemo(() => resolveActiveWildcardQuery(value, caretPosition), [value, caretPosition])
  const explorerTreeNodes = useMemo(
    () => filterWildcardTree(wildcards, (node) => matchesWorkspaceTab(node, activeExplorerTab)),
    [activeExplorerTab, wildcards],
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
        naiItemCount: countWildcardItemsForTool(record.items, 'nai'),
        comfyuiItemCount: countWildcardItemsForTool(record.items, 'comfyui'),
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

  const explorerEntries = useMemo(() => flattenWildcardTree(explorerTreeNodes), [explorerTreeNodes])
  const isTreeExplorerMode = filterMode === 'all' && (activeQuery === null || (activeQuery?.query.trim().length ?? 0) === 0)
  const isPopupOpen = isFocused && (activeQuery !== null || isExplorerPinned) && !disabled
  const normalizedActiveQuery = activeQuery?.query.trim() ?? ''
  const indexedSuggestions = suggestions.map((suggestion, index) => ({ ...suggestion, index }))
  const recentSuggestions = normalizedActiveQuery.length === 0
    ? indexedSuggestions.filter((suggestion) => Number.isFinite(suggestion.recentIndex))
    : []
  const remainingSuggestions = normalizedActiveQuery.length === 0
    ? indexedSuggestions.filter((suggestion) => !Number.isFinite(suggestion.recentIndex))
    : indexedSuggestions

  useEffect(() => {
    setActiveIndex(0)
  }, [activeQuery?.query, filterMode, tool])

  useEffect(() => {
    setFilterMode(readStoredWildcardFilterMode(tool))
    setRecentWildcardNames(readStoredRecentWildcards(tool))
  }, [tool])

  useEffect(() => {
    if (explorerEntries.length === 0) {
      setSelectedExplorerId(null)
      return
    }

    if (selectedExplorerId === null || !explorerEntries.some((entry) => entry.wildcard.id === selectedExplorerId)) {
      const firstEntry = explorerEntries[0]
      setSelectedExplorerId(firstEntry.wildcard.id)
      setExpandedExplorerIds((current) => Array.from(new Set([...current, ...explorerEntries.filter((entry) => entry.depth === 0).map((entry) => entry.wildcard.id)])))
    }
  }, [explorerEntries, selectedExplorerId])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  const syncCaretPosition = (element: HTMLInputElement | HTMLTextAreaElement) => {
    setCaretPosition(element.selectionStart ?? element.value.length)
  }

  const handleChangeValue = (nextValue: string, element: HTMLInputElement | HTMLTextAreaElement) => {
    onChange(nextValue)
    syncCaretPosition(element)

    if (activeQuery === null && isExplorerPinned) {
      setIsExplorerPinned(false)
    }
  }

  const handleInsertWildcard = (wildcardName: string) => {
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

    const { nextValue, nextCaretPosition } = buildWildcardInsertion(value, wildcardName, insertionRange)
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

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!isPopupOpen || isTreeExplorerMode || suggestions.length === 0) {
      return
    }

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
    className,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChangeValue(event.target.value, event.target),
    onKeyDown: handleKeyDown,
    onKeyUp: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => syncCaretPosition(event.currentTarget),
    onClick: (event: MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => syncCaretPosition(event.currentTarget),
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

  const renderSuggestionButton = ({
    record,
    toolItemCount,
    naiItemCount,
    comfyuiItemCount,
    recentIndex,
    index,
  }: {
    record: FlattenedWildcardRecord
    toolItemCount: number
    naiItemCount: number
    comfyuiItemCount: number
    recentIndex: number
    index: number
  }) => {
    const isActive = index === activeIndex
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
            <span className="truncate text-sm font-medium text-foreground">{renderHighlightedText(record.name, normalizedActiveQuery) as ReactNode}</span>
            <Badge variant={record.type === 'chain' ? 'secondary' : 'outline'}>{record.type === 'chain' ? 'Chain' : 'Wildcard'}</Badge>
            {record.isAutoCollected ? <Badge variant="outline">Auto LoRA</Badge> : null}
            {Number.isFinite(recentIndex) ? <Badge variant="secondary">최근 사용</Badge> : null}
            {toolItemCount === 0 ? <Badge variant="outline">현재 툴 비어있음</Badge> : null}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{renderHighlightedText(record.path.join(' / '), normalizedActiveQuery) as ReactNode}</div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge variant={tool === 'nai' ? 'secondary' : 'outline'}>NAI {naiItemCount}</Badge>
          <Badge variant={tool === 'comfyui' ? 'secondary' : 'outline'}>Comfy {comfyuiItemCount}</Badge>
        </div>
      </button>
    )
  }

  return (
    <div className="relative">
      {multiline ? (
        <textarea
          ref={(node) => {
            fieldRef.current = node
          }}
          rows={rows}
          {...sharedProps}
          className={cn(textareaVariants(), className)}
        />
      ) : (
        <input
          ref={(node) => {
            fieldRef.current = node
          }}
          type="text"
          {...sharedProps}
          className={cn(inputVariants(), className)}
        />
      )}

      {isPopupOpen ? (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-2 rounded-sm border border-border bg-surface-container shadow-lg"
          onMouseDown={(event) => {
            event.preventDefault()
          }}
        >
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
                  현재 툴 항목만
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
            <div className="max-h-72 space-y-3 overflow-y-auto p-2">
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
              {filterMode === 'available-only' ? <div className="text-xs">현재 툴 항목만 켜져 있으면 다른 툴 전용 와일드카드는 숨겨질 수 있어.</div> : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
