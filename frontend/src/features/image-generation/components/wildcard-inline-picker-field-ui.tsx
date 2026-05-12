import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { FLOATING_DROPDOWN_MENU_CLASS } from './floating-dropdown-utils'
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

export function getPromptSyntaxChipClass(kind: PromptSyntaxTokenKind, isActive: boolean) {
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
          {token.loraWeight ? <div className="text-[12px] text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.field.weight.token.loraweight', { weight: token.loraWeight })}</div> : null}
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
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 bg-surface-container/95 px-2 py-1.5">
        <span className="px-1 font-mono text-[11px] text-muted-foreground">{page + 1}/{pageCount}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('image-generation.components.wildcard.inline.picker.autocomplete.previous.suggestion.page')}
            title={t('image-generation.components.wildcard.inline.picker.autocomplete.previous')}
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
            aria-label={t('image-generation.components.wildcard.inline.picker.autocomplete.next.suggestion.page')}
            title={t('image-generation.components.wildcard.inline.picker.autocomplete.next')}
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
              <div className="truncate px-1 text-[11px] text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.autocomplete.related.tags.for', { label: activeCharacter.label })}</div>
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
              <div className="px-2 py-2 text-xs text-muted-foreground">{t('image-generation.components.wildcard.inline.picker.autocomplete.no.suggestions')}</div>
            )}
          </div>
          {!isLoading && visibleSuggestions.length > 0 ? renderPager(suggestionPage, suggestionPageCount, setSuggestionPage) : null}
        </>
      )}
    </WildcardInlinePickerPopup>
  )
}
