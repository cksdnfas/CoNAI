import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject, type SyntheticEvent, type UIEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { inputVariants } from '@/components/ui/input'
import { textareaVariants } from '@/components/ui/textarea'
import { getDanbooruBrowserCharacters, getDanbooruBrowserTags } from '@/lib/api-danbooru-browser'
import { searchPromptCollection } from '@/lib/api-prompts'
import { getWildcards } from '@/lib/api-wildcards'
import { cn } from '@/lib/utils'
import type { PromptCollectionItem, PromptTypeFilter } from '@/types/prompt'
import type { DanbooruBrowserCharacterRecord, DanbooruBrowserRelatedTagRecord, DanbooruBrowserTagRecord } from '@/types/danbooru-browser'
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
  type PromptSyntaxToken,
  type PromptSyntaxTokenKind,
} from './prompt-syntax-highlight-helpers'
import { useWildcardWorkspaceBrowser } from './use-wildcard-workspace-browser'
import { WildcardInlinePickerExplorer } from './wildcard-inline-picker-explorer'
import { FLOATING_DROPDOWN_MENU_CLASS, resolveFloatingDropdownRectFromRect } from './floating-dropdown-utils'

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

type PromptSyntaxPopupPosition = {
  top: number
  left: number
  width: number
  placement: 'top' | 'bottom'
}

type InlinePickerPopupPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

type PromptAutocompleteQuery = {
  query: string
  start: number
  end: number
}

type PromptAutocompleteSuggestion = {
  id: string
  kind: 'prompt' | 'tag' | 'character'
  label: string
  insertText: string
  translatedName?: string | null
  secondaryText?: string
  usageCount?: number
  relatedTags?: DanbooruBrowserRelatedTagRecord[]
}

type PromptRelatedTagTab = 'general' | 'character' | 'other'

const PROMPT_AUTOCOMPLETE_SEPARATOR_PATTERN = /[,\n]/
const PROMPT_AUTOCOMPLETE_PAGE_SIZE = 7
const PROMPT_AUTOCOMPLETE_RELATED_TAG_LIMIT = 42
const PROMPT_AUTOCOMPLETE_LABEL_MAX_LENGTH = 48
const PROMPT_RELATED_TAG_TABS: Array<{ id: PromptRelatedTagTab; label: string }> = [
  { id: 'general', label: '일반' },
  { id: 'character', label: '캐릭터' },
  { id: 'other', label: '그외' },
]

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

function normalizeAutocompleteText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function resolvePromptAutocompleteQuery(value: string, caretPosition: number): PromptAutocompleteQuery | null {
  if (caretPosition < 0) {
    return null
  }

  const caret = Math.max(0, Math.min(caretPosition, value.length))
  let segmentStart = caret
  while (segmentStart > 0 && !PROMPT_AUTOCOMPLETE_SEPARATOR_PATTERN.test(value[segmentStart - 1])) {
    segmentStart -= 1
  }

  let segmentEnd = caret
  while (segmentEnd < value.length && !PROMPT_AUTOCOMPLETE_SEPARATOR_PATTERN.test(value[segmentEnd])) {
    segmentEnd += 1
  }

  while (segmentStart < segmentEnd && /\s/.test(value[segmentStart])) {
    segmentStart += 1
  }
  while (segmentEnd > segmentStart && /\s/.test(value[segmentEnd - 1])) {
    segmentEnd -= 1
  }

  return {
    query: value.slice(segmentStart, caret).trim(),
    start: segmentStart,
    end: segmentEnd,
  }
}

function buildPromptAutocompleteInsertion(value: string, insertionText: string, range: PromptAutocompleteQuery, mode: 'replace' | 'append' = 'replace') {
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

function getRelatedTagTab(categoryName: string): PromptRelatedTagTab {
  const normalizedCategoryName = categoryName.toLowerCase()
  if (normalizedCategoryName === 'general') {
    return 'general'
  }
  if (normalizedCategoryName === 'character') {
    return 'character'
  }
  return 'other'
}

function getPromptAutocompleteKindLabel(kind: PromptAutocompleteSuggestion['kind']) {
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

function formatPromptAutocompleteLabel(item: Pick<PromptAutocompleteSuggestion, 'label' | 'translatedName' | 'usageCount'>) {
  const labelText = truncatePromptAutocompleteText(item.label)
  const translatedText = item.translatedName?.trim()
  const formattedCount = formatPromptAutocompleteCount(item.usageCount)
  const countText = formattedCount ? ` (${formattedCount})` : ''
  return `${labelText}${translatedText ? ` [${truncatePromptAutocompleteText(translatedText, 24)}]` : ''}${countText}`
}

function isSameAutocompleteCharacter(left: PromptAutocompleteSuggestion | null, right: PromptAutocompleteSuggestion | null) {
  return left?.kind === 'character' && right?.kind === 'character' && left.id === right.id
}

function getPromptSyntaxHighlightClass(kind: PromptSyntaxTokenKind) {
  if (kind === 'wildcard') {
    return 'rounded-[0.2rem] bg-sky-400/20 ring-1 ring-inset ring-sky-300/18'
  }

  if (kind === 'preprocess') {
    return 'rounded-[0.2rem] bg-amber-400/18 ring-1 ring-inset ring-amber-300/20'
  }

  if (kind === 'comment') {
    return 'rounded-[0.2rem] bg-emerald-400/16 ring-1 ring-inset ring-emerald-300/20'
  }

  return 'rounded-[0.2rem] bg-violet-400/18 ring-1 ring-inset ring-violet-300/20'
}

function getPromptSyntaxChipClass(kind: PromptSyntaxTokenKind, isActive: boolean) {
  const shared = 'inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors'

  if (kind === 'wildcard') {
    return cn(shared, isActive ? 'border-sky-300/60 bg-sky-400/18 text-foreground' : 'border-sky-400/20 bg-sky-400/10 text-foreground/90 hover:bg-sky-400/16')
  }

  if (kind === 'preprocess') {
    return cn(shared, isActive ? 'border-amber-300/60 bg-amber-400/18 text-foreground' : 'border-amber-400/20 bg-amber-400/10 text-foreground/90 hover:bg-amber-400/16')
  }

  if (kind === 'comment') {
    return cn(shared, isActive ? 'border-emerald-300/60 bg-emerald-400/18 text-foreground' : 'border-emerald-400/20 bg-emerald-400/10 text-foreground/90 hover:bg-emerald-400/16')
  }

  return cn(shared, isActive ? 'border-violet-300/60 bg-violet-400/18 text-foreground' : 'border-violet-400/20 bg-violet-400/10 text-foreground/90 hover:bg-violet-400/16')
}

function renderPromptSyntaxOverlay(value: string, tokens: PromptSyntaxToken[]) {
  if (!value || tokens.length === 0) {
    return value
  }

  const nodes: ReactNode[] = []
  let cursor = 0

  for (const token of tokens) {
    if (token.start > cursor) {
      nodes.push(value.slice(cursor, token.start))
    }

    nodes.push(
      <mark key={token.id} className={cn('text-transparent', getPromptSyntaxHighlightClass(token.kind))}>
        {value.slice(token.start, token.end)}
      </mark>,
    )
    cursor = token.end
  }

  if (cursor < value.length) {
    nodes.push(value.slice(cursor))
  }

  if (value.endsWith('\n')) {
    nodes.push('\u200b')
  }

  return nodes
}

const CARET_MIRROR_STYLE_PROPERTIES = [
  'boxSizing',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'textIndent',
  'textTransform',
  'tabSize',
  'wordBreak',
  'overflowWrap',
] as const

function resolveLineHeight(style: CSSStyleDeclaration) {
  const lineHeight = Number.parseFloat(style.lineHeight)
  if (Number.isFinite(lineHeight)) {
    return lineHeight
  }

  const fontSize = Number.parseFloat(style.fontSize)
  return Number.isFinite(fontSize) ? fontSize * 1.2 : 18
}

function getTextFieldCaretClientRect(element: HTMLInputElement | HTMLTextAreaElement, caretPosition: number) {
  if (typeof document === 'undefined') {
    return null
  }

  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }

  const style = window.getComputedStyle(element)
  const mirror = document.createElement('div')
  const marker = document.createElement('span')
  const position = Math.max(0, Math.min(caretPosition, element.value.length))

  for (const property of CARET_MIRROR_STYLE_PROPERTIES) {
    mirror.style[property] = style[property]
  }

  mirror.style.position = 'fixed'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.left = `${rect.left}px`
  mirror.style.top = `${rect.top}px`
  mirror.style.width = `${rect.width}px`
  mirror.style.minHeight = `${rect.height}px`
  mirror.style.height = 'auto'
  mirror.style.overflow = 'visible'
  mirror.style.whiteSpace = element instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre'
  mirror.style.wordWrap = 'break-word'

  mirror.textContent = element.value.slice(0, position) || '\u200b'
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const markerRect = marker.getBoundingClientRect()
  const lineHeight = resolveLineHeight(style)
  const top = markerRect.top - element.scrollTop
  const left = markerRect.left - element.scrollLeft

  document.body.removeChild(mirror)

  return {
    left,
    top,
    bottom: top + lineHeight,
    width: 0,
  }
}

function PromptSyntaxTokenPopup({ token, position, popupRef, onMouseEnter, onMouseLeave }: {
  token: PromptSyntaxToken
  position: PromptSyntaxPopupPosition
  popupRef: RefObject<HTMLDivElement | null>
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      ref={popupRef}
      className="z-[150] rounded-sm border border-border bg-background/97 px-3 py-2.5 shadow-[0_12px_30px_rgba(0,0,0,0.32)] backdrop-blur-sm"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: position.width,
        transform: position.placement === 'top' ? 'translateY(-100%)' : undefined,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="space-y-2.5">
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{getPromptSyntaxKindLabel(token.kind)}</div>
          <div className="break-all text-sm font-medium text-foreground">{token.name}</div>
          {token.loraWeight ? <div className="text-[12px] text-muted-foreground">가중치 {token.loraWeight}</div> : null}
        </div>

        {token.previewItems.length > 0 ? (
          <div className="space-y-1.5">
            {token.previewItems.map((item, index) => (
              <div key={`${token.key}:preview:${index}`} className="rounded-sm border border-border/70 bg-surface-lowest px-2.5 py-2 text-[12px] leading-5 text-foreground/92">
                <div className="break-words whitespace-pre-wrap">{item}</div>
              </div>
            ))}
          </div>
        ) : token.fallbackMessage ? (
          <div className="rounded-sm border border-border/70 bg-surface-lowest px-2.5 py-2 text-[12px] leading-5 text-foreground/92">
            {token.fallbackMessage}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

function WildcardInlinePickerPopup({
  position,
  children,
}: {
  position: InlinePickerPopupPosition
  children: ReactNode
}) {
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={cn(FLOATING_DROPDOWN_MENU_CLASS, 'z-[160] overflow-hidden bg-surface-container')}
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
    >
      <div className="flex max-h-[inherit] min-h-0 flex-col overflow-hidden rounded-sm">{children}</div>
    </div>,
    document.body,
  )
}

function PromptAutocompletePopup({
  position,
  suggestions,
  activeCharacter,
  isLoading,
  onSelect,
  onSelectRelatedTag,
}: {
  position: InlinePickerPopupPosition
  suggestions: PromptAutocompleteSuggestion[]
  activeCharacter: PromptAutocompleteSuggestion | null
  isLoading: boolean
  onSelect: (suggestion: PromptAutocompleteSuggestion) => void
  onSelectRelatedTag: (tagName: string) => void
}) {
  const [suggestionPage, setSuggestionPage] = useState(0)
  const [relatedTagTab, setRelatedTagTab] = useState<PromptRelatedTagTab>('general')
  const [relatedTagPage, setRelatedTagPage] = useState(0)
  const relatedTags = useMemo(() => (
    (activeCharacter?.relatedTags ?? [])
      .slice()
      .sort((left, right) => right.usageCount - left.usageCount)
  ), [activeCharacter?.relatedTags])
  const hasActiveCharacter = activeCharacter !== null
  const visibleSuggestions = hasActiveCharacter ? [] : suggestions.slice(suggestionPage * PROMPT_AUTOCOMPLETE_PAGE_SIZE, (suggestionPage + 1) * PROMPT_AUTOCOMPLETE_PAGE_SIZE)
  const suggestionPageCount = Math.max(1, Math.ceil(suggestions.length / PROMPT_AUTOCOMPLETE_PAGE_SIZE))
  const relatedTagsByTab = relatedTags.filter((tag) => getRelatedTagTab(tag.categoryName) === relatedTagTab)
  const visibleRelatedTags = relatedTagsByTab.slice(relatedTagPage * PROMPT_AUTOCOMPLETE_PAGE_SIZE, (relatedTagPage + 1) * PROMPT_AUTOCOMPLETE_PAGE_SIZE)
  const relatedTagPageCount = Math.max(1, Math.ceil(relatedTagsByTab.length / PROMPT_AUTOCOMPLETE_PAGE_SIZE))

  useEffect(() => {
    setSuggestionPage(0)
  }, [suggestions])

  useEffect(() => {
    setRelatedTagTab('general')
    setRelatedTagPage(0)
  }, [activeCharacter])

  useEffect(() => {
    setRelatedTagPage(0)
  }, [relatedTagTab])

  const renderPager = (page: number, pageCount: number, onPageChange: (page: number) => void) => (
    pageCount > 1 ? (
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 bg-surface-container/95 px-2 py-1.5">
        <span className="px-1 font-mono text-[11px] text-muted-foreground">{page + 1}/{pageCount}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="이전 추천 페이지"
            title="이전"
            disabled={page <= 0}
            onMouseDown={(event) => {
              event.preventDefault()
              onPageChange(Math.max(0, page - 1))
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border/70 bg-surface-lowest text-muted-foreground transition hover:bg-surface-high hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="다음 추천 페이지"
            title="다음"
            disabled={page >= pageCount - 1}
            onMouseDown={(event) => {
              event.preventDefault()
              onPageChange(Math.min(pageCount - 1, page + 1))
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border/70 bg-surface-lowest text-muted-foreground transition hover:bg-surface-high hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    ) : null
  )

  return (
    <WildcardInlinePickerPopup position={position}>
      {hasActiveCharacter ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="space-y-2">
              <div className="truncate px-1 text-[11px] text-muted-foreground">{activeCharacter.label} 연관 태그</div>
              <div className="flex flex-wrap gap-1">
                {PROMPT_RELATED_TAG_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      setRelatedTagTab(tab.id)
                    }}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] transition',
                      relatedTagTab === tab.id ? 'border-primary/50 bg-primary/15 text-foreground' : 'border-border/70 text-muted-foreground hover:bg-surface-high',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {visibleRelatedTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {visibleRelatedTags.map((tag) => (
                    <button
                      key={`${activeCharacter.id}:related:${tag.id}`}
                      type="button"
                      title={tag.translatedName ? `${tag.displayName} [${tag.translatedName}]` : tag.displayName}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        onSelectRelatedTag(tag.name)
                      }}
                      className="inline-flex max-w-full items-center rounded-full border border-border/70 bg-surface-lowest px-2.5 py-1 text-xs text-foreground transition hover:bg-surface-high"
                    >
                      <span className="truncate">{formatPromptAutocompleteLabel({ label: tag.displayName, translatedName: tag.translatedName, usageCount: tag.usageCount })}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-1 py-1 text-xs text-muted-foreground">이 분류에는 연관 태그가 없어.</div>
              )}
            </div>
          </div>
          {renderPager(relatedTagPage, relatedTagPageCount, setRelatedTagPage)}
        </>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">불러오는 중…</div>
            ) : visibleSuggestions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {visibleSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    title={getPromptAutocompleteKindLabel(suggestion.kind)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      onSelect(suggestion)
                    }}
                    className="inline-flex max-w-full items-center rounded-full border border-border/70 bg-surface-lowest px-2.5 py-1 text-xs text-foreground transition hover:bg-surface-high"
                  >
                    <span className="truncate">{formatPromptAutocompleteLabel(suggestion)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-2 py-2 text-xs text-muted-foreground">추천 없음</div>
            )}
          </div>
          {!isLoading && visibleSuggestions.length > 0 ? renderPager(suggestionPage, suggestionPageCount, setSuggestionPage) : null}
        </>
      )}
    </WildcardInlinePickerPopup>
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
  const [selectedPromptAutocompleteCharacter, setSelectedPromptAutocompleteCharacter] = useState<PromptAutocompleteSuggestion | null>(null)

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
  const activePromptAutocompleteQuery = useMemo(
    () => (activeQuery === null && !isExplorerPinned ? resolvePromptAutocompleteQuery(value, caretPosition) : null),
    [activeQuery, caretPosition, isExplorerPinned, value],
  )
  const promptAutocompleteSearchText = activePromptAutocompleteQuery?.query.trim() ?? ''
  const isPromptAutocompleteOpen = isFocused && !disabled && !isPopupOpen && activePromptAutocompleteQuery !== null
  const normalizedActiveQuery = activeQuery?.query.trim() ?? ''
  const indexedSuggestions = suggestions.map((suggestion, index) => ({ ...suggestion, index }))
  const recentSuggestions = normalizedActiveQuery.length === 0
    ? indexedSuggestions.filter((suggestion) => Number.isFinite(suggestion.recentIndex))
    : []
  const remainingSuggestions = normalizedActiveQuery.length === 0
    ? indexedSuggestions.filter((suggestion) => !Number.isFinite(suggestion.recentIndex))
    : indexedSuggestions

  const promptAutocompletePromptsQuery = useQuery({
    queryKey: ['prompt-inline-autocomplete', 'collection', autocompletePromptType, promptAutocompleteSearchText],
    queryFn: () => searchPromptCollection({
      query: promptAutocompleteSearchText,
      type: autocompletePromptType,
      page: 1,
      limit: PROMPT_AUTOCOMPLETE_PAGE_SIZE * 3,
      sortBy: 'usage_count',
      sortOrder: 'DESC',
    }),
    enabled: isPromptAutocompleteOpen,
    staleTime: 30_000,
  })
  const promptAutocompleteTagsQuery = useQuery({
    queryKey: ['prompt-inline-autocomplete', 'danbooru-tags', promptAutocompleteSearchText],
    queryFn: () => getDanbooruBrowserTags({ query: promptAutocompleteSearchText, page: 1, limit: PROMPT_AUTOCOMPLETE_PAGE_SIZE * 3 }),
    enabled: isPromptAutocompleteOpen && promptAutocompleteSearchText.length > 0,
    staleTime: 60_000,
    retry: false,
  })
  const promptAutocompleteCharactersQuery = useQuery({
    queryKey: ['prompt-inline-autocomplete', 'danbooru-characters', promptAutocompleteSearchText],
    queryFn: () => getDanbooruBrowserCharacters({
      query: promptAutocompleteSearchText,
      page: 1,
      limit: PROMPT_AUTOCOMPLETE_PAGE_SIZE * 3,
      relatedTagLimit: PROMPT_AUTOCOMPLETE_RELATED_TAG_LIMIT,
    }),
    enabled: isPromptAutocompleteOpen && promptAutocompleteSearchText.length >= 2,
    staleTime: 60_000,
    retry: false,
  })
  const promptAutocompleteSuggestions = useMemo(
    () => buildPromptAutocompleteSuggestions({
      prompts: promptAutocompletePromptsQuery.data?.items ?? [],
      tags: promptAutocompleteTagsQuery.data?.items ?? [],
      characters: promptAutocompleteCharactersQuery.data?.items ?? [],
    }),
    [promptAutocompleteCharactersQuery.data?.items, promptAutocompletePromptsQuery.data?.items, promptAutocompleteTagsQuery.data?.items],
  )
  const exactPromptAutocompleteCharacter = useMemo(() => {
    const normalizedQuery = normalizeAutocompleteText(promptAutocompleteSearchText).replace(/ /g, '_')
    if (!normalizedQuery) {
      return null
    }

    return promptAutocompleteSuggestions.find((suggestion) => (
      suggestion.kind === 'character'
        && (normalizeAutocompleteText(suggestion.insertText) === normalizedQuery || normalizeAutocompleteText(suggestion.label).replace(/ /g, '_') === normalizedQuery)
    )) ?? null
  }, [promptAutocompleteSearchText, promptAutocompleteSuggestions])
  const activePromptAutocompleteCharacter = isSameAutocompleteCharacter(selectedPromptAutocompleteCharacter, exactPromptAutocompleteCharacter)
    ? selectedPromptAutocompleteCharacter
    : (selectedPromptAutocompleteCharacter ?? exactPromptAutocompleteCharacter)
  const isPromptAutocompleteLoading = promptAutocompletePromptsQuery.isLoading || promptAutocompleteTagsQuery.isLoading || promptAutocompleteCharactersQuery.isLoading

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
    if (selectedPromptAutocompleteCharacter && promptAutocompleteSearchText.length > 0 && normalizeAutocompleteText(selectedPromptAutocompleteCharacter.insertText) !== normalizeAutocompleteText(promptAutocompleteSearchText)) {
      setSelectedPromptAutocompleteCharacter(null)
    }
  }, [promptAutocompleteSearchText, selectedPromptAutocompleteCharacter])

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
            <span className="truncate text-sm font-medium text-foreground">{renderHighlightedText(record.name, normalizedActiveQuery) as ReactNode}</span>
            <Badge variant={record.type === 'chain' ? 'secondary' : 'outline'}>{record.type === 'chain' ? 'Chain' : 'Wildcard'}</Badge>
            {record.isAutoCollected ? <Badge variant="outline">Auto LoRA</Badge> : null}
            {Number.isFinite(recentIndex) ? <Badge variant="secondary">최근 사용</Badge> : null}
            {toolItemCount === 0 ? <Badge variant="outline">현재 툴 비어있음</Badge> : null}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{renderHighlightedText(record.path.join(' / '), normalizedActiveQuery) as ReactNode}</div>
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
