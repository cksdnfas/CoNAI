import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { inputVariants } from '@/components/ui/input'
import { textareaVariants } from '@/components/ui/textarea'
import { getWildcards, type WildcardItemRecord, type WildcardRecord, type WildcardTool } from '@/lib/api'
import { cn } from '@/lib/utils'

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

type WildcardFilterMode = 'available-only' | 'all'

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
  const [filterMode, setFilterMode] = useState<WildcardFilterMode>('available-only')

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
    const records = flattenedWildcards
      .map((record) => ({
        record,
        score: scoreWildcardMatch(record, normalizedQuery),
        toolItemCount: countItemsForTool(record.items, tool),
        naiItemCount: countItemsForTool(record.items, 'nai'),
        comfyuiItemCount: countItemsForTool(record.items, 'comfyui'),
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
        if (right.score !== left.score) {
          return right.score - left.score
        }

        if (right.toolItemCount !== left.toolItemCount) {
          return right.toolItemCount - left.toolItemCount
        }

        return left.record.path.join('/').localeCompare(right.record.path.join('/'))
      })
      .slice(0, 8)

    return records
  }, [activeQuery, filterMode, flattenedWildcards, tool])

  const isPopupOpen = isFocused && activeQuery !== null && !disabled

  useEffect(() => {
    setActiveIndex(0)
  }, [activeQuery?.query, filterMode, tool])

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
  }

  const handleInsertWildcard = (wildcardName: string) => {
    if (!fieldRef.current || !activeQuery) {
      return
    }

    const token = `++${wildcardName}++`
    const nextValue = `${value.slice(0, activeQuery.start)}${token}${value.slice(activeQuery.end)}`
    const nextCaretPosition = activeQuery.start + token.length

    onChange(nextValue)
    setCaretPosition(nextCaretPosition)
    setActiveIndex(0)

    window.requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!isPopupOpen || suggestions.length === 0) {
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
      }, 120)
    },
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
        <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-sm border border-border bg-surface-container shadow-lg">
          <div className="space-y-2 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span>
                `++` 와일드카드 {tool === 'nai' ? 'NAI' : 'ComfyUI'} 검색
              </span>
              <Badge variant="outline">{suggestions.length}</Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  setFilterMode('available-only')
                }}
                className={cn(
                  'rounded-sm border px-2 py-1 transition-colors',
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
                }}
                className={cn(
                  'rounded-sm border px-2 py-1 transition-colors',
                  filterMode === 'all' ? 'border-primary bg-surface-high text-foreground' : 'border-border bg-surface-lowest hover:bg-surface-high',
                )}
              >
                전체 보기
              </button>
            </div>
          </div>

          {wildcardsQuery.isLoading ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">와일드카드 불러오는 중…</div>
          ) : suggestions.length > 0 ? (
            <div className="max-h-72 overflow-y-auto p-2">
              {suggestions.map(({ record, toolItemCount, naiItemCount, comfyuiItemCount }, index) => {
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
                        <span className="truncate text-sm font-medium text-foreground">{record.name}</span>
                        <Badge variant={record.type === 'chain' ? 'secondary' : 'outline'}>{record.type === 'chain' ? 'Chain' : 'Wildcard'}</Badge>
                        {record.isAutoCollected ? <Badge variant="outline">Auto LoRA</Badge> : null}
                        {toolItemCount === 0 ? <Badge variant="outline">현재 툴 비어있음</Badge> : null}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{record.path.join(' / ')}</div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Badge variant={tool === 'nai' ? 'secondary' : 'outline'}>NAI {naiItemCount}</Badge>
                      <Badge variant={tool === 'comfyui' ? 'secondary' : 'outline'}>Comfy {comfyuiItemCount}</Badge>
                    </div>
                  </button>
                )
              })}
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
