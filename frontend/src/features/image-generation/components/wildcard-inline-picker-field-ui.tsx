import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  getPromptSyntaxKindLabel,
  type PromptSyntaxToken,
  type PromptSyntaxTokenKind,
} from './prompt-syntax-highlight-helpers'
import {
  PROMPT_AUTOCOMPLETE_PAGE_SIZE,
  PROMPT_RELATED_TAG_TABS,
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
const PROMPT_SYNTAX_TONE: Record<PromptSyntaxTokenKind, { overlay: string, chip: string, activeChip: string }> = {
  wildcard: {
    overlay: 'bg-info/18 ring-info/25',
    chip: 'bg-info-soft text-info-soft-foreground hover:bg-info-soft hover:text-info-soft-foreground',
    activeChip: 'ring-info/70',
  },
  preprocess: {
    overlay: 'bg-warning/18 ring-warning/25',
    chip: 'bg-warning-soft text-warning-soft-foreground hover:bg-warning-soft hover:text-warning-soft-foreground',
    activeChip: 'ring-warning/70',
  },
  comment: {
    overlay: 'bg-success/16 ring-success/25',
    chip: 'bg-success-soft text-success-soft-foreground hover:bg-success-soft hover:text-success-soft-foreground',
    activeChip: 'ring-success/70',
  },
  lora: {
    overlay: 'bg-primary/16 ring-primary/25',
    chip: 'bg-primary/12 text-foreground hover:bg-primary/18 hover:text-foreground',
    activeChip: 'ring-primary/60',
  },
}

function getPromptSyntaxTone(kind: PromptSyntaxTokenKind) {
  return PROMPT_SYNTAX_TONE[kind] ?? PROMPT_SYNTAX_TONE.lora
}

function getPromptSyntaxHighlightClass(kind: PromptSyntaxTokenKind) {
  return cn('rounded-sm ring-1 ring-inset', getPromptSyntaxTone(kind).overlay)
}

/** Classes for a detected-syntax chip rendered as `<Button variant="ghost" size="xs">`: a tonal category fill, ring when active. */
export function getPromptSyntaxChipClass(kind: PromptSyntaxTokenKind, isActive: boolean) {
  const tone = getPromptSyntaxTone(kind)
  return cn('min-w-0 font-normal tracking-normal text-2xs hover:brightness-110', tone.chip, isActive && cn('ring-1 ring-inset', tone.activeChip))
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

export function PromptSyntaxTokenPopup({ token, position, popupRef, onMouseEnter, onMouseLeave }: {
  token: PromptSyntaxToken
  position: PromptSyntaxPopupPosition
  popupRef: RefObject<HTMLDivElement | null>
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const { t } = useI18n()

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      ref={popupRef}
      data-surface="high"
      // Sits just above the inline picker's anchored popovers (z-popover = 140).
      className="z-[150] rounded-md bg-surface-high px-3 py-2.5 shadow-elevation-2"
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
          <Text as="div" variant="overline" className="font-semibold">{getPromptSyntaxKindLabel(token.kind)}</Text>
          <div className="break-all text-sm font-medium text-foreground">{token.name}</div>
          {token.loraWeight ? <div className="text-xs text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.field.weight.token.loraweight', { weight: token.loraWeight })}</div> : null}
        </div>

        {token.previewItems.length > 0 ? (
          <div className="space-y-1.5">
            {token.previewItems.map((item, index) => (
              <div key={`${token.key}:preview:${index}`} className="rounded-sm bg-surface-container px-2.5 py-2 text-xs leading-5 text-foreground">
                <div className="break-words whitespace-pre-wrap">{item}</div>
              </div>
            ))}
          </div>
        ) : token.fallbackMessage ? (
          <div className="rounded-sm bg-surface-container px-2.5 py-2 text-xs leading-5 text-foreground">
            {token.fallbackMessage}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

export function WildcardInlinePickerPopup({
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
      data-surface="high"
      // Above the token popup (z-[150]) and anchored popovers (z-popover = 140).
      className="fixed z-[160] overflow-hidden rounded-md bg-surface-high shadow-elevation-2"
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
      <div className="flex max-h-[inherit] min-h-0 flex-col overflow-hidden rounded-md">{children}</div>
    </div>,
    document.body,
  )
}

export function PromptAutocompletePopup({
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
  const { t } = useI18n()
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
    <WildcardInlinePickerPopup position={position}>
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
                      size="xs"
                      variant="secondary"
                      className="max-w-full font-normal"
                      title={tag.translatedName ? `${tag.displayName} [${tag.translatedName}]` : tag.displayName}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        onSelectRelatedTag(tag.name)
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
              <div className="flex flex-wrap gap-1.5">
                {visibleSuggestions.map((suggestion) => (
                  <Button
                    key={suggestion.id}
                    type="button"
                    size="xs"
                    variant="secondary"
                    className="max-w-full font-normal"
                    title={getPromptAutocompleteKindLabel(suggestion.kind)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      onSelect(suggestion)
                    }}
                  >
                    <span className="truncate">{formatPromptAutocompleteLabel(suggestion)}</span>
                  </Button>
                ))}
              </div>
            ) : (
              <div className="px-2 py-2 text-xs text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.autocomplete.no.suggestions')}</div>
            )}
          </div>
          {!isLoading && visibleSuggestions.length > 0 ? renderPager(suggestionPage, suggestionPageCount, setSuggestionPage) : null}
        </>
      )}
    </WildcardInlinePickerPopup>
  )
}
