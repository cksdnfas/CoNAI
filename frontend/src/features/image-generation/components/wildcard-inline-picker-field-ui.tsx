import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { floatingSurfaceClassName } from '@/components/ui/floating-surface'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { wildcardItemsQueryOptions } from '@/lib/api-wildcards'
import type { PromptWildcardTool } from './wildcard-inline-picker-helpers'
import { getFloatingDropdownStyle } from './floating-dropdown-utils'
import { usePromptInlineSyntaxSettings } from './prompt-inline-syntax-settings'
import { PROMPT_RANDOM_SOURCE_TONE } from './prompt-random-palette'
import { formatPromptRandomTokenLabel, type PromptRandomToken } from './prompt-random-token'
import type { PromptRandomTokenStatus } from './use-prompt-random-sources'
import {
  getPromptSyntaxKindLabel,
  type PromptSyntaxToken,
  type PromptSyntaxTokenKind,
} from './prompt-syntax-highlight-helpers'
import {
  PROMPT_AUTOCOMPLETE_PAGE_SIZE,
  PROMPT_RELATED_TAG_TABS,
  formatDanbooruTagForPrompt,
  formatPromptAutocompleteCount,
  formatPromptAutocompleteLabel,
  getPromptAutocompleteKindLabel,
  getRelatedTagTab,
  type PromptAutocompleteSuggestion,
  type PromptRelatedTagTab,
} from './use-prompt-inline-autocomplete'

export type PromptSyntaxPopupPosition = {
  top: number
  left: number
  width: number
  /** Space left on the chosen side; the popup scrolls past it. */
  maxHeight: number
  placement: 'top' | 'bottom'
}

export type InlinePickerPopupPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

/** Highlight the first matched query segment inside one suggestion label. */
export function renderHighlightedText(text: string, query: string) {
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

/**
 * Prompt syntax kinds are categorical, mapped onto theme tokens so they stay legible in dark and light themes:
 * wildcard = info, preprocess = warning, comment = success, LoRA / other = primary.
 */
const PROMPT_SYNTAX_TONE: Record<PromptSyntaxTokenKind, { overlay: string, chip: 'info' | 'warning' | 'success' | 'primary' }> = {
  wildcard: {
    overlay: 'bg-info/18 ring-info/25',
    chip: 'info',
  },
  preprocess: {
    overlay: 'bg-warning/18 ring-warning/25',
    chip: 'warning',
  },
  comment: {
    overlay: 'bg-success/16 ring-success/25',
    chip: 'success',
  },
  lora: {
    overlay: 'bg-primary/16 ring-primary/25',
    chip: 'primary',
  },
}

function getPromptSyntaxTone(kind: PromptSyntaxTokenKind) {
  return PROMPT_SYNTAX_TONE[kind] ?? PROMPT_SYNTAX_TONE.lora
}

/** ToggleChip tone of a detected-syntax chip, matching the kind's highlight colour in the prompt. */
export function getPromptSyntaxChipTone(kind: PromptSyntaxTokenKind) {
  return getPromptSyntaxTone(kind).chip
}

function getPromptSyntaxHighlightClass(kind: PromptSyntaxTokenKind) {
  return cn('rounded-sm ring-1 ring-inset', getPromptSyntaxTone(kind).overlay)
}

export function renderPromptSyntaxOverlay(value: string, tokens: PromptSyntaxToken[]) {
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

type ChipLabelBox = { left: number; top: number; width: number; height: number }

/** The element an absolutely positioned child of `node` is placed against: nearest positioned or transformed ancestor. */
function findAbsoluteContainingBlock(node: HTMLElement) {
  for (let current = node.parentElement; current; current = current.parentElement) {
    const style = window.getComputedStyle(current)
    if (style.position !== 'static' || style.transform !== 'none') {
      return current
    }
  }
  return null
}

/**
 * One random token in the overlay: its raw text stays (invisible) so wrapping matches the textarea, every line piece
 * gets the tone fill, and the label sits on the widest piece, so a token broken over two lines still shows its label.
 */
function PromptRandomTokenChip({ raw, label, className }: { raw: string; label: string; className: string }) {
  const chipRef = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<ChipLabelBox | null>(null)
  const [, setResizeTick] = useState(0)

  // A field resize rewraps the text without re-rendering the overlay; re-measure then.
  useEffect(() => {
    const container = chipRef.current ? findAbsoluteContainingBlock(chipRef.current) : null
    if (!container) {
      return
    }
    const observer = new ResizeObserver(() => setResizeTick((tick) => tick + 1))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Measured every render: typing, rewrapping and scrolling all re-render the overlay.
  useLayoutEffect(() => {
    const chip = chipRef.current
    const container = chip ? findAbsoluteContainingBlock(chip) : null
    if (!chip || !container) {
      return
    }
    const pieces = Array.from(chip.getClientRects())
    if (pieces.length === 0) {
      return
    }
    const widest = pieces.reduce((best, piece) => (piece.width > best.width ? piece : best))
    const origin = container.getBoundingClientRect()
    const next = { left: widest.left - origin.left, top: widest.top - origin.top, width: widest.width, height: widest.height }
    setBox((current) => (
      current && current.left === next.left && current.top === next.top && current.width === next.width && current.height === next.height ? current : next
    ))
  })

  return (
    <span ref={chipRef} className={cn('rounded-sm ring-1 ring-inset [-webkit-box-decoration-break:clone] [box-decoration-break:clone]', className)}>
      <span className="invisible">{raw}</span>
      {box ? (
        <span className="absolute overflow-hidden px-1 text-xs text-ellipsis whitespace-nowrap" style={box}>
          {label}
        </span>
      ) : null}
    </span>
  )
}

/**
 * Visible-text overlay used when the prompt has random tokens: the textarea text is transparent and this layer draws
 * the text, with each random token shown as a chip label laid over its (invisible) raw text so wrapping stays identical.
 */
export function renderPromptFieldOverlay(
  value: string,
  syntaxTokens: PromptSyntaxToken[],
  randomTokens: PromptRandomToken[],
  getTokenStatus: (token: PromptRandomToken) => PromptRandomTokenStatus,
  activeTokenKey: string | null,
) {
  const ranges = [
    ...randomTokens.map((token) => ({ start: token.start, end: token.end, random: token, syntax: null })),
    ...syntaxTokens
      .filter((token) => !randomTokens.some((random) => token.start < random.end && token.end > random.start))
      .map((token) => ({ start: token.start, end: token.end, random: null, syntax: token })),
  ].sort((left, right) => left.start - right.start)

  const nodes: ReactNode[] = []
  let cursor = 0

  for (const range of ranges) {
    if (range.start < cursor) {
      continue
    }
    if (range.start > cursor) {
      nodes.push(value.slice(cursor, range.start))
    }
    const raw = value.slice(range.start, range.end)
    if (range.random) {
      const status = getTokenStatus(range.random)
      nodes.push(
        <PromptRandomTokenChip
          key={range.random.key}
          raw={raw}
          label={`${status.state === 'missing' ? '⚠ ' : '🎲 '}${formatPromptRandomTokenLabel({ ...range.random, source: status.source })}`}
          className={cn(
            status.state === 'missing' ? 'bg-destructive/12 text-destructive ring-destructive/50' : cn(PROMPT_RANDOM_SOURCE_TONE[status.source], 'ring-transparent'),
            range.random.key === activeTokenKey && 'ring-current',
          )}
        />,
      )
    } else if (range.syntax) {
      nodes.push(<mark key={range.syntax.id} className={cn('text-inherit', getPromptSyntaxHighlightClass(range.syntax.kind))}>{raw}</mark>)
    }
    cursor = range.end
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
  'fontFeatureSettings',
  'fontVariationSettings',
  'fontKerning',
  'wordSpacing',
] as const

/** Use the control's resolved metrics, including caller overrides, for the highlight mirror. */
export function syncPromptOverlayStyle(field: HTMLInputElement | HTMLTextAreaElement, overlay: HTMLDivElement) {
  const style = window.getComputedStyle(field)
  for (const property of CARET_MIRROR_STYLE_PROPERTIES) {
    overlay.style[property] = style[property]
  }
  overlay.style.borderStyle = 'solid'
  overlay.style.borderColor = 'transparent'
  overlay.style.whiteSpace = field instanceof HTMLTextAreaElement ? style.whiteSpace : 'pre'
}

function resolveLineHeight(style: CSSStyleDeclaration) {
  const lineHeight = Number.parseFloat(style.lineHeight)
  if (Number.isFinite(lineHeight)) {
    return lineHeight
  }

  const fontSize = Number.parseFloat(style.fontSize)
  return Number.isFinite(fontSize) ? fontSize * 1.2 : 18
}

export function getTextFieldCaretClientRect(element: HTMLInputElement | HTMLTextAreaElement, caretPosition: number) {
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

export function PromptSyntaxTokenPopup({ token, tool, position, popupRef, onMouseEnter, onMouseLeave }: {
  token: PromptSyntaxToken
  tool: PromptWildcardTool
  position: PromptSyntaxPopupPosition
  popupRef: RefObject<HTMLDivElement | null>
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const { t } = useI18n()
  const itemsQuery = useQuery(wildcardItemsQueryOptions(token.wildcardId, tool, 3))
  const previewItems = Array.from(new Set((itemsQuery.data ?? []).map((item) => item.content.trim()).filter(Boolean))).slice(0, 3)

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      ref={popupRef}
      data-surface="high"
      // A popup opened from inside the inline picker's anchored popover: one layer above z-popover.
      className={cn('z-popover-nested overflow-y-auto overscroll-contain px-3 py-2.5', floatingSurfaceClassName)}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
        transform: position.placement === 'top' ? 'translateY(-100%)' : undefined,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="space-y-2.5">
        <div className="space-y-1">
          <Text as="div" variant="overline">{getPromptSyntaxKindLabel(token.kind)}</Text>
          <div className="break-all text-sm font-medium text-foreground">{token.name}</div>
          {token.loraWeight ? <div className="text-xs text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.field.weight.token.loraweight', { weight: token.loraWeight })}</div> : null}
        </div>

        {itemsQuery.isLoading ? (
          <div className="text-xs text-muted-foreground">{t({ ko: '불러오는 중…', en: 'Loading…' })}</div>
        ) : itemsQuery.isError ? (
          <div className="text-xs text-destructive">{t({ ko: '미리보기를 불러오지 못했어.', en: 'Could not load the preview.' })}</div>
        ) : previewItems.length > 0 ? (
          <div className="space-y-1.5">
            {previewItems.map((item, index) => (
              <div key={`${token.key}:preview:${index}`} className="rounded-sm bg-surface-container px-2.5 py-2 text-xs leading-5 text-foreground">
                <div className="break-words whitespace-pre-wrap">{item}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-sm bg-surface-container px-2.5 py-2 text-xs leading-5 text-foreground">
            {token.fallbackMessage ?? t({ ko: '연결된 항목이 없어.', en: 'No linked items.' })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function WildcardInlinePickerPopup({
  position,
  popupRef,
  children,
}: {
  position: InlinePickerPopupPosition
  popupRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      ref={popupRef}
      data-surface="high"
      // Above the token preview (z-popover-nested) and anchored popovers (z-popover).
      className={cn('fixed z-[calc(var(--z-index-popover-nested)+10)] overflow-hidden', floatingSurfaceClassName)}
      style={getFloatingDropdownStyle(position)}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
    >
      <div className="flex max-h-[inherit] min-h-0 flex-col overflow-hidden rounded-md">{children}</div>
    </div>,
    document.body,
  )
}

export function PromptAutocompletePopup({
  position,
  popupRef,
  suggestions,
  activeIndex = -1,
  activeCharacter,
  isLoading,
  onSelect,
  onSelectRelatedTag,
}: {
  position: InlinePickerPopupPosition
  popupRef?: RefObject<HTMLDivElement | null>
  suggestions: PromptAutocompleteSuggestion[]
  /** Keyboard-highlighted row; -1 when nothing is highlighted. */
  activeIndex?: number
  activeCharacter: PromptAutocompleteSuggestion | null
  isLoading: boolean
  onSelect: (suggestion: PromptAutocompleteSuggestion) => void
  onSelectRelatedTag: (tagName: string) => void
}) {
  const { t } = useI18n()
  const { settings: syntaxSettings } = usePromptInlineSyntaxSettings()
  const [relatedTagTab, setRelatedTagTab] = useState<PromptRelatedTagTab>('general')
  const [relatedTagPage, setRelatedTagPage] = useState(0)
  const relatedTags = useMemo(() => (
    (activeCharacter?.relatedTags ?? [])
      .slice()
      .sort((left, right) => right.usageCount - left.usageCount)
  ), [activeCharacter?.relatedTags])
  const hasActiveCharacter = activeCharacter !== null
  const visibleSuggestions = hasActiveCharacter ? [] : suggestions
  const relatedTagsByTab = relatedTags.filter((tag) => getRelatedTagTab(tag.categoryName) === relatedTagTab)
  const visibleRelatedTags = relatedTagsByTab.slice(relatedTagPage * PROMPT_AUTOCOMPLETE_PAGE_SIZE, (relatedTagPage + 1) * PROMPT_AUTOCOMPLETE_PAGE_SIZE)
  const relatedTagPageCount = Math.max(1, Math.ceil(relatedTagsByTab.length / PROMPT_AUTOCOMPLETE_PAGE_SIZE))

  useEffect(() => {
    setRelatedTagTab('general')
    setRelatedTagPage(0)
  }, [activeCharacter])

  useEffect(() => {
    setRelatedTagPage(0)
  }, [relatedTagTab])

  const renderPager = (page: number, pageCount: number, onPageChange: (page: number) => void) => (
    pageCount > 1 ? (
      <div className="flex shrink-0 items-center justify-between gap-2 bg-surface-high px-2 py-1.5">
        <span className="px-1 font-mono text-2xs text-muted-foreground">{page + 1}/{pageCount}</span>
        <div className="flex items-center gap-1">
          <IconButton
            size="icon-xs"
            variant="ghost"
            label={t('image-generation.components.wildcard.inline.picker.autocomplete.previous.suggestion.page')}
            tooltip={false}
            disabled={page <= 0}
            onMouseDown={(event) => {
              event.preventDefault()
              onPageChange(Math.max(0, page - 1))
            }}
          >
            <ChevronLeft />
          </IconButton>
          <IconButton
            size="icon-xs"
            variant="ghost"
            label={t('image-generation.components.wildcard.inline.picker.autocomplete.next.suggestion.page')}
            tooltip={false}
            disabled={page >= pageCount - 1}
            onMouseDown={(event) => {
              event.preventDefault()
              onPageChange(Math.min(pageCount - 1, page + 1))
            }}
          >
            <ChevronRight />
          </IconButton>
        </div>
      </div>
    ) : null
  )

  return (
    <WildcardInlinePickerPopup position={position} popupRef={popupRef}>
      {hasActiveCharacter ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="space-y-2">
              <div className="truncate px-1 text-2xs text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.autocomplete.related.tags.for', { label: activeCharacter.label })}</div>
              <div className="flex flex-wrap gap-1">
                {PROMPT_RELATED_TAG_TABS.map((tab) => (
                  <Button
                    key={tab.id}
                    type="button"
                    size="xs"
                    variant={relatedTagTab === tab.id ? 'secondary' : 'ghost'}
                    aria-pressed={relatedTagTab === tab.id}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      setRelatedTagTab(tab.id)
                    }}
                  >
                    {tab.label}
                  </Button>
                ))}
              </div>
              {visibleRelatedTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {visibleRelatedTags.map((tag) => (
                    <Button
                      key={`${activeCharacter.id}:related:${tag.id}`}
                      type="button"
                      size="content"
                      variant="secondary"
                      className="max-w-full"
                      title={tag.translatedName ? `${tag.displayName} [${tag.translatedName}]` : tag.displayName}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        onSelectRelatedTag(formatDanbooruTagForPrompt(tag.name, syntaxSettings.tagUnderscores))
                      }}
                    >
                      <span className="truncate">{formatPromptAutocompleteLabel({ label: tag.displayName, translatedName: tag.translatedName, usageCount: tag.usageCount })}</span>
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="px-1 py-1 text-xs text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.autocomplete.no.related.tags.in.category')}</div>
              )}
            </div>
          </div>
          {renderPager(relatedTagPage, relatedTagPageCount, setRelatedTagPage)}
        </>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.autocomplete.loading')}</div>
            ) : visibleSuggestions.length > 0 ? (
              <div role="listbox" className="flex flex-col">
                {visibleSuggestions.map((suggestion, index) => (
                  <ListRow
                    key={suggestion.id}
                    asChild
                    interactive
                    size="sm"
                    selected={index === activeIndex}
                    leading={<span className="rounded-sm bg-surface-container px-1 text-2xs text-muted-foreground">{getPromptAutocompleteKindLabel(suggestion.kind)}</span>}
                    trailing={(
                      <>
                        {suggestion.relatedCount ? <span className="rounded-sm bg-primary/10 px-1 text-2xs text-foreground">{t({ ko: '함께 씀', en: 'Used together' })}</span> : null}
                        <span className="font-mono text-2xs tabular-nums">{formatPromptAutocompleteCount(suggestion.usageCount)}</span>
                      </>
                    )}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      tabIndex={-1}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        onSelect(suggestion)
                      }}
                    >
                      <span className="truncate">
                        {suggestion.insertText}
                        {suggestion.translatedName ? <span className="ml-1.5 text-xs text-muted-foreground">{suggestion.translatedName}</span> : null}
                      </span>
                    </button>
                  </ListRow>
                ))}
              </div>
            ) : (
              <div className="px-2 py-2 text-xs text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.autocomplete.no.suggestions')}</div>
            )}
          </div>
          {!isLoading && visibleSuggestions.length > 0 ? (
            <div className="flex shrink-0 gap-3 bg-surface-high px-3 py-1 text-2xs text-muted-foreground">
              <span>{t({ ko: '↑↓ 이동', en: '↑↓ move' })}</span>
              <span>{t({ ko: 'Enter/Tab 넣기', en: 'Enter/Tab insert' })}</span>
              <span>{t({ ko: 'Esc 닫기', en: 'Esc close' })}</span>
            </div>
          ) : null}
        </>
      )}
    </WildcardInlinePickerPopup>
  )
}
