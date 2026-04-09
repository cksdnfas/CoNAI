import { ChevronRight, Folder, FolderOpen, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Badge } from '@/components/ui/badge'
import { inputVariants } from '@/components/ui/input'
import { textareaVariants } from '@/components/ui/textarea'
import { getWildcards, type WildcardItemRecord, type WildcardRecord, type WildcardTool } from '@/lib/api'
import { cn } from '@/lib/utils'
import { filterWildcardTree, flattenWildcardTree, matchesWorkspaceTab, type WildcardWorkspaceTab } from './wildcard-generation-panel-helpers'

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

type FlattenedWildcardRecord = {
  id: number
  name: string
  path: string[]
  type: WildcardRecord['type']
  isAutoCollected: boolean
  items: WildcardItemRecord[]
}

type ActiveWildcardQuery = {
  start: number
  end: number
  query: string
}

type WildcardInsertionRange = {
  start: number
  end: number
}

type WildcardFilterMode = 'available-only' | 'all'

const WILDCARD_INLINE_EXPLORER_TABS: Array<{ value: WildcardWorkspaceTab; label: string }> = [
  { value: 'wildcards', label: '와일드카드' },
  { value: 'preprocess', label: '전처리' },
  { value: 'lora', label: '로라' },
]

const RECENT_WILDCARD_KEY_PREFIX = 'conai.wildcards.recent.'
const FILTER_MODE_KEY_PREFIX = 'conai.wildcards.filter-mode.'
const MAX_RECENT_WILDCARDS = 8

function readStoredWildcardFilterMode(tool: WildcardTool): WildcardFilterMode {
  if (typeof window === 'undefined') {
    return 'available-only'
  }

  const value = window.localStorage.getItem(`${FILTER_MODE_KEY_PREFIX}${tool}`)
  return value === 'all' ? 'all' : 'available-only'
}

function writeStoredWildcardFilterMode(tool: WildcardTool, mode: WildcardFilterMode) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(`${FILTER_MODE_KEY_PREFIX}${tool}`, mode)
}

function readStoredRecentWildcards(tool: WildcardTool): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(`${RECENT_WILDCARD_KEY_PREFIX}${tool}`)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function writeStoredRecentWildcards(tool: WildcardTool, names: string[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(`${RECENT_WILDCARD_KEY_PREFIX}${tool}`, JSON.stringify(names.slice(0, MAX_RECENT_WILDCARDS)))
}

function flattenWildcards(nodes: WildcardRecord[], parentPath: string[] = []): FlattenedWildcardRecord[] {
  const entries: FlattenedWildcardRecord[] = []

  for (const node of nodes) {
    const path = [...parentPath, node.name]
    entries.push({
      id: node.id,
      name: node.name,
      path,
      type: node.type,
      isAutoCollected: node.is_auto_collected === 1,
      items: node.items ?? [],
    })

    if (node.children && node.children.length > 0) {
      entries.push(...flattenWildcards(node.children, path))
    }
  }

  return entries
}

function resolveActiveWildcardQuery(value: string, caretPosition: number): ActiveWildcardQuery | null {
  const prefix = value.slice(0, Math.max(0, caretPosition))
  const tokenStart = prefix.lastIndexOf('++')

  if (tokenStart < 0) {
    return null
  }

  if (tokenStart > 0) {
    const previousCharacter = prefix[tokenStart - 1]
    if (!/[\s,(]/.test(previousCharacter)) {
      return null
    }
  }

  const query = prefix.slice(tokenStart + 2)
  if (query.includes('++')) {
    return null
  }

  if (/[\s,()]/.test(query)) {
    return null
  }

  return {
    start: tokenStart,
    end: caretPosition,
    query,
  }
}

function countItemsForTool(items: WildcardItemRecord[], tool: WildcardTool) {
  return items.filter((item) => item.tool === tool).length
}

/** Build the next prompt value for inline wildcard insertion, auto-adding comma separators when chaining entries. */
function buildWildcardInsertion(value: string, wildcardName: string, range: WildcardInsertionRange) {
  const token = `++${wildcardName}++`
  const before = value.slice(0, range.start)
  const after = value.slice(range.end)
  const needsLeadingSeparator = before.trim().length > 0 && !/[\s,(]$/.test(before)
  const insertedText = `${needsLeadingSeparator ? ', ' : ''}${token}`

  return {
    nextValue: `${before}${insertedText}${after}`,
    nextCaretPosition: before.length + insertedText.length,
  }
}

function scoreWildcardMatch(record: FlattenedWildcardRecord, normalizedQuery: string) {
  if (!normalizedQuery) {
    return 0
  }

  const name = record.name.toLowerCase()
  const path = record.path.join(' / ').toLowerCase()

  if (name === normalizedQuery) {
    return 100
  }

  if (name.startsWith(normalizedQuery)) {
    return 80
  }

  if (name.includes(normalizedQuery)) {
    return 60
  }

  if (path.includes(normalizedQuery)) {
    return 40
  }

  return -1
}

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

  const flattenedWildcards = useMemo(() => flattenWildcards(wildcardsQuery.data ?? []), [wildcardsQuery.data])
  const activeQuery = useMemo(() => resolveActiveWildcardQuery(value, caretPosition), [value, caretPosition])

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
        toolItemCount: countItemsForTool(record.items, tool),
        naiItemCount: countItemsForTool(record.items, 'nai'),
        comfyuiItemCount: countItemsForTool(record.items, 'comfyui'),
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

  const explorerTreeNodes = useMemo(
    () => filterWildcardTree(wildcardsQuery.data ?? [], (node) => matchesWorkspaceTab(node, activeExplorerTab)),
    [activeExplorerTab, wildcardsQuery.data],
  )
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

  const renderExplorerTree = (nodes: WildcardRecord[], depth = 0): ReactNode => {
    if (nodes.length === 0) {
      return null
    }

    return (
      <div className="space-y-1">
        {nodes.map((node) => {
          const hasChildren = (node.children?.length ?? 0) > 0
          const isExpanded = expandedExplorerIds.includes(node.id)
          const isSelected = selectedExplorerId === node.id
          const naiItemCount = countItemsForTool(node.items ?? [], 'nai')
          const comfyuiItemCount = countItemsForTool(node.items ?? [], 'comfyui')

          return (
            <div key={node.id} className="space-y-1">
              <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 14}px` }}>
                {hasChildren ? (
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      toggleExplorerExpanded(node.id)
                      setSelectedExplorerId(node.id)
                    }}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-low hover:text-foreground"
                    aria-label={isExpanded ? '접기' : '펼치기'}
                    title={isExpanded ? '접기' : '펼치기'}
                  >
                    <ChevronRight className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')} />
                  </button>
                ) : (
                  <span className="inline-flex h-8 w-8 shrink-0" aria-hidden="true" />
                )}

                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    setSelectedExplorerId(node.id)
                    if (hasChildren) {
                      toggleExplorerExpanded(node.id)
                    }
                  }}
                  className={cn(
                    'inline-flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                    isSelected ? 'bg-surface-high text-foreground' : 'hover:bg-surface-lowest text-foreground',
                  )}
                  title={node.name}
                >
                  {hasChildren || isSelected ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
                  <span className="truncate">{node.name}</span>
                </button>

                <div className="hidden shrink-0 items-center gap-1 md:flex">
                  <Badge variant={tool === 'nai' ? 'secondary' : 'outline'}>NAI {naiItemCount}</Badge>
                  <Badge variant={tool === 'comfyui' ? 'secondary' : 'outline'}>Comfy {comfyuiItemCount}</Badge>
                </div>

                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    handleInsertWildcard(node.name)
                  }}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-lowest text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground"
                  aria-label={`++${node.name}++ 추가`}
                  title={`++${node.name}++ 추가`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {hasChildren && isExpanded ? renderExplorerTree(node.children ?? [], depth + 1) : null}
            </div>
          )
        })}
      </div>
    )
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

            {isTreeExplorerMode ? (
              <SegmentedTabBar
                value={activeExplorerTab}
                items={WILDCARD_INLINE_EXPLORER_TABS}
                onChange={(value) => setActiveExplorerTab(value as WildcardWorkspaceTab)}
                fullWidth
                size="xs"
                className="border-b-0 pb-0"
              />
            ) : null}
          </div>

          {wildcardsQuery.isLoading ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">와일드카드 불러오는 중…</div>
          ) : isTreeExplorerMode ? (
            <div className="max-h-80 overflow-y-auto p-2">
              {explorerEntries.length > 0 ? (
                <div className="space-y-1 rounded-sm border border-border/70 bg-surface-low p-2">
                  {renderExplorerTree(explorerTreeNodes)}
                </div>
              ) : (
                <div className="rounded-sm border border-border/70 bg-surface-low px-3 py-3 text-sm text-muted-foreground">이 분류에는 아직 항목이 없어.</div>
              )}
            </div>
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
