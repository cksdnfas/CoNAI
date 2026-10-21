import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type SyntheticEvent, type UIEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AtSign, Dices } from 'lucide-react'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { inputVariants } from '@/components/ui/input'
import { textareaVariants } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { parseWildcards } from '@/lib/api-wildcards'
import { cn } from '@/lib/utils'
import {
  convertLegacyPromptSyntax,
  findPromptRandomTokens,
  removePromptRandomToken,
  replacePromptRange,
  resolveActivePaletteQuery,
  serializePromptRandomToken,
  type PromptRandomTokenSpec,
} from './prompt-random-token'
import {
  filterPromptPaletteEntries,
  PROMPT_PALETTE_TABS,
  PromptRandomPalette,
  readPromptPaletteRecents,
  rememberPromptPaletteEntry,
  type PromptPaletteTab,
} from './prompt-random-palette'
import { PromptRandomTokenEditor } from './prompt-random-token-editor'
import { createWildcardNameMatcher, usePromptRandomSources, type PromptRandomSourceEntry } from './use-prompt-random-sources'
import type { PromptTypeFilter } from '@/types/prompt'
import { flattenWildcardRecords, type PromptWildcardTool } from './wildcard-inline-picker-helpers'
import {
  detectPromptSyntaxTokens,
  summarizePromptSyntaxTokens,
} from './prompt-syntax-highlight-helpers'
import { useWildcardInlinePickerData } from './use-wildcard-inline-picker-data'
import {
  buildPromptAutocompleteInsertion,
  usePromptInlineAutocomplete,
  type PromptAutocompleteSuggestion,
} from './use-prompt-inline-autocomplete'
import { usePromptInlineSyntaxSettings } from './prompt-inline-syntax-settings'
import { useWildcardInlineDetectedCharacters } from './use-wildcard-inline-detected-characters'
import { useWildcardInlinePickerSuggestions } from './use-wildcard-inline-picker-suggestions'
import { WildcardInlinePickerDetectedChips } from './wildcard-inline-picker-detected-chips'
import { useWildcardInlinePopupPositions } from './use-wildcard-inline-popup-positions'
import { WildcardInlinePickerPopupContent } from './wildcard-inline-picker-popup-content'
import {
  PromptAutocompletePopup,
  PromptSyntaxTokenPopup,
  renderPromptFieldOverlay,
  renderPromptSyntaxOverlay,
  syncPromptOverlayStyle,
  WildcardInlinePickerPopup,
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
  /** Mark the field invalid for assistive tech (aria-invalid). */
  invalid?: boolean
  /** Id of the element that describes the current validation error. */
  errorMessageId?: string
}

/** Shared prompt-like text field: tag autocomplete, `@` random-source palette, and random tokens shown as editable chips. */
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
  invalid = false,
  errorMessageId,
}: WildcardInlinePickerFieldProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const detectedPopupCloseTimerRef = useRef<number | null>(null)
  const detectedPopupRef = useRef<HTMLDivElement | null>(null)
  const detectedTokenButtonRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const detectedCharacterButtonRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const [caretPosition, setCaretPosition] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [promptAutocompleteIndex, setPromptAutocompleteIndex] = useState(-1)
  const [isFocused, setIsFocused] = useState(false)
  const [fieldScrollTop, setFieldScrollTop] = useState(0)
  const [fieldScrollLeft, setFieldScrollLeft] = useState(0)
  const [activeDetectedTokenKey, setActiveDetectedTokenKey] = useState<string | null>(null)
  const [activeDetectedCharacterKey, setActiveDetectedCharacterKey] = useState<string | null>(null)
  const [paletteTab, setPaletteTab] = useState<PromptPaletteTab>('all')
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [paletteRecents, setPaletteRecents] = useState<string[]>(() => readPromptPaletteRecents(tool))
  /** Position of the `@` that Ctrl+Space or the `@` button inserted: opens the palette even when typing triggers are off. */
  const [explicitPaletteStart, setExplicitPaletteStart] = useState<number | null>(null)
  const [dismissedPaletteStart, setDismissedPaletteStart] = useState<number | null>(null)
  const [dismissedTokenKey, setDismissedTokenKey] = useState<string | null>(null)
  const [dismissedSuggestionAt, setDismissedSuggestionAt] = useState<{ value: string; caret: number } | null>(null)
  const [isRollPreviewOpen, setIsRollPreviewOpen] = useState(false)
  const [rollNonce, setRollNonce] = useState(0)
  const [legacyUndo, setLegacyUndo] = useState<{ before: string; after: string; count: number } | null>(null)
  const { t } = useI18n()
  const { canViewWildcards } = useFeaturePermissions()
  const { settings: syntaxSettings } = usePromptInlineSyntaxSettings()
  const randomTokens = useMemo(() => findPromptRandomTokens(value), [value])
  // `__my:그룹__`은 이 칸 종류(긍정/부정)의 같은 이름 그룹으로 풀린다
  const randomPromptKind = autocompletePromptType === 'negative' ? 'negative' : 'positive'
  const shouldLoadWildcardData =!disabled && (isFocused || randomTokens.length > 0)
  const typedPaletteQuery = useMemo(() => resolveActivePaletteQuery(value, caretPosition), [caretPosition, value])
  const paletteRange = typedPaletteQuery
    && typedPaletteQuery.start !== dismissedPaletteStart
    && (syntaxSettings.triggers.random || typedPaletteQuery.start === explicitPaletteStart)
    ? typedPaletteQuery
    : null
  const isPaletteOpen = isFocused && !disabled && paletteRange !== null
  // 팔레트가 열려 있으면 다른 추천 팝업은 쉬게 한다
  // Esc로 닫은 추천은 글자나 커서가 바뀔 때까지 다시 열지 않는다
  const isSuggestionDismissed = dismissedSuggestionAt !== null
    && dismissedSuggestionAt.value === value
    && dismissedSuggestionAt.caret === caretPosition
  const suggestionCaretPosition = isPaletteOpen || isSuggestionDismissed ? -1 : caretPosition

  const { wildcardsQuery, flattenedWildcards } = useWildcardInlinePickerData({ enabled: shouldLoadWildcardData })
  const {
    activeSource,
    activePreprocessQuery,
    preprocessSuggestions,
    normalizedActiveQuery,
    indexedSuggestions,
  } = useWildcardInlinePickerSuggestions({
    value,
    caretPosition: suggestionCaretPosition,
    syntaxSettings,
    flattenedWildcards,
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
  const detectedCharacters = useWildcardInlineDetectedCharacters(value, syntaxSettings.characterRelatedTags)
  const activeDetectedCharacter = useMemo(
    () => detectedCharacters.find((character) => character.candidate.key === activeDetectedCharacterKey) ?? null,
    [activeDetectedCharacterKey, detectedCharacters],
  )

  const {
    entries: randomSourceEntries,
    isWildcardName,
    getTokenStatus,
    isLoading: isRandomSourcesLoading,
  } = usePromptRandomSources({ flattenedWildcards, wildcardsReady: wildcardsQuery.isSuccess, enabled: shouldLoadWildcardData, promptType: autocompletePromptType })
  const paletteEntries = useMemo(
    () => (isPaletteOpen ? filterPromptPaletteEntries(randomSourceEntries, paletteTab, paletteRange?.query ?? '', paletteRecents) : []),
    [isPaletteOpen, paletteRange?.query, paletteRecents, paletteTab, randomSourceEntries],
  )
  const activeRandomToken = randomTokens.find((token) => token.start < caretPosition && caretPosition < token.end) ?? null
  const isTokenEditorOpen = isFocused && !disabled && !isPaletteOpen && activeRandomToken !== null && activeRandomToken.key !== dismissedTokenKey
  const missingTokens = randomTokens
    .map((token) => ({ token, status: getTokenStatus(token) }))
    .filter(({ status }) => status.state === 'missing')
  const legacyConversion = useMemo(
    () => (wildcardsQuery.isSuccess ? convertLegacyPromptSyntax(value, isWildcardName) : { value, count: 0 }),
    [isWildcardName, value, wildcardsQuery.isSuccess],
  )
  const rollPreviewQuery = useQuery({
    queryKey: ['prompt-field-roll-preview', tool, randomPromptKind, value, rollNonce],
    queryFn: () => parseWildcards({ text: value, tool, count: 3, promptType: randomPromptKind }),
    enabled: isRollPreviewOpen && canViewWildcards && value.trim().length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const isPopupOpen = isFocused && !disabled && !isPaletteOpen && activeSource === 'preprocess'
  const {
    activeQuery: activePromptAutocompleteQuery,
    isOpen: isPromptAutocompleteOpen,
    suggestions: promptAutocompleteSuggestions,
    activeCharacter: activePromptAutocompleteCharacter,
    isLoading: isPromptAutocompleteLoading,
    setSelectedCharacter: setSelectedPromptAutocompleteCharacter,
  } = usePromptInlineAutocomplete({
    value,
    caretPosition: suggestionCaretPosition,
    isFocused,
    disabled: disabled || activeSource !== 'tag',
    isWildcardPopupOpen: isPopupOpen,
    autocompletePromptType,
    tagUnderscores: syntaxSettings.tagUnderscores,
  })
  const {
    detectedPopupPosition,
    detectedCharacterPopupPosition,
    inlinePopupPosition,
    promptAutocompletePopupPosition,
  } = useWildcardInlinePopupPositions({
    activeDetectedTokenKey,
    activeDetectedCharacterKey: activeDetectedCharacter?.candidate.key ?? null,
    // 전처리 추천, 팔레트, 칩 편집기는 동시에 열리지 않으므로 같은 커서 위치 팝업 자리를 함께 쓴다
    isPopupOpen: isPopupOpen || isPaletteOpen || isTokenEditorOpen,
    isPromptAutocompleteOpen,
    rootRef,
    fieldRef,
    detectedTokenButtonRefs,
    detectedCharacterButtonRefs,
    caretPosition,
    fieldScrollLeft,
    fieldScrollTop,
    suggestionsLength: indexedSuggestions.length + paletteEntries.length,
    promptAutocompleteSuggestionsLength: promptAutocompleteSuggestions.length,
    value,
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
  }, [activePreprocessQuery?.query, activeSource, tool])

  useEffect(() => {
    setPaletteRecents(readPromptPaletteRecents(tool))
  }, [tool])

  // `__`, `__tag:`, `__my:`로 연 팔레트는 맞는 탭에서 시작한다
  const typedPaletteStart = typedPaletteQuery?.start
  const typedPaletteTab = typedPaletteQuery?.tab
  useEffect(() => {
    if (typedPaletteTab) {
      setPaletteTab(typedPaletteTab)
    }
  }, [typedPaletteStart, typedPaletteTab])

  // 목록이 바뀌면 선택 해제: Enter는 화살표로 고른 뒤에만 추천을 넣고, 그 전엔 줄바꿈으로 동작
  useEffect(() => {
    setPromptAutocompleteIndex(-1)
  }, [promptAutocompleteSuggestions])

  useEffect(() => {
    setPaletteIndex(0)
  }, [paletteRange?.query, paletteTab])

  // `@`를 지우면 닫았던 팔레트 기록도 지워서 다음 `@`에서 다시 열리게 한다
  useEffect(() => {
    if (typedPaletteQuery === null) {
      setDismissedPaletteStart(null)
    }
  }, [typedPaletteQuery])

  // 예전 문법 변환 뒤 사용자가 다시 고치면 되돌리기를 거둔다
  useEffect(() => {
    if (legacyUndo && value !== legacyUndo.after) {
      setLegacyUndo(null)
    }
  }, [legacyUndo, value])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
    }
    if (detectedPopupCloseTimerRef.current !== null) {
      window.clearTimeout(detectedPopupCloseTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (activeDetectedCharacterKey && !detectedCharacters.some((character) => character.candidate.key === activeDetectedCharacterKey)) {
      setActiveDetectedCharacterKey(null)
    }
  }, [activeDetectedCharacterKey, detectedCharacters])

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

  const applyValueWithCaret = (nextValue: string, nextCaretPosition: number) => {
    onChange(nextValue)
    setCaretPosition(nextCaretPosition)

    window.requestAnimationFrame(() => {
      fieldRef.current?.focus()
      fieldRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }

  /** Insert a palette source as a token; with `openEditor` the caret lands inside it so the chip editor opens. */
  const handleInsertPaletteEntry = (entry: PromptRandomSourceEntry, openEditor: boolean) => {
    if (!paletteRange) {
      return
    }

    const tokenText = serializePromptRandomToken({ source: entry.source, name: entry.name, pick: { min: 1, max: 1 }, usage: {} })
    const { nextValue, nextCaretPosition } = buildPromptAutocompleteInsertion(value, tokenText, paletteRange)
    const tokenEnd = nextValue.lastIndexOf(tokenText, nextCaretPosition) + tokenText.length

    setExplicitPaletteStart(null)
    setDismissedTokenKey(null)
    setPaletteRecents(rememberPromptPaletteEntry(tool, paletteRecents, entry))
    applyValueWithCaret(nextValue, openEditor ? tokenEnd - 2 : nextCaretPosition)
  }

  /** Ctrl+Space / `@` button: type an `@` at the caret so the palette opens and the user can keep typing to filter. */
  const openPaletteAtCaret = (caret: number) => {
    const before = value.slice(0, caret)
    const prefix = before.length > 0 && !/[\s,(]$/.test(before) ? ' ' : ''
    const insertAt = caret + prefix.length
    setPaletteTab('all')
    setDismissedPaletteStart(null)
    setExplicitPaletteStart(insertAt)
    applyValueWithCaret(`${before}${prefix}@${value.slice(caret)}`, insertAt + 1)
  }

  const handleChangeRandomToken = (spec: PromptRandomTokenSpec) => {
    if (!activeRandomToken) {
      return
    }

    const tokenText = serializePromptRandomToken(spec)
    applyValueWithCaret(replacePromptRange(value, activeRandomToken.start, activeRandomToken.end, tokenText), activeRandomToken.start + tokenText.length - 2)
  }

  const handleRemoveRandomToken = () => {
    if (!activeRandomToken) {
      return
    }

    const nextValue = removePromptRandomToken(value, activeRandomToken)
    applyValueWithCaret(nextValue, Math.min(activeRandomToken.start, nextValue.length))
  }

  const handleRenameRandomToken = (token: (typeof randomTokens)[number], source: PromptRandomTokenSpec['source'], name: string) => {
    const tokenText = serializePromptRandomToken({ ...token, source, name })
    applyValueWithCaret(replacePromptRange(value, token.start, token.end, tokenText), token.start + tokenText.length)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === ' ' && event.ctrlKey) {
      event.preventDefault()
      openPaletteAtCaret(event.currentTarget.selectionStart ?? caretPosition)
      return
    }

    if (isPaletteOpen && paletteRange) {
      if (event.key === 'ArrowDown' && paletteEntries.length > 0) {
        event.preventDefault()
        setPaletteIndex((current) => (current + 1) % paletteEntries.length)
        return
      }

      if (event.key === 'ArrowUp' && paletteEntries.length > 0) {
        event.preventDefault()
        setPaletteIndex((current) => (current - 1 + paletteEntries.length) % paletteEntries.length)
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        const tabIndex = PROMPT_PALETTE_TABS.indexOf(paletteTab)
        setPaletteTab(PROMPT_PALETTE_TABS[(tabIndex + (event.shiftKey ? -1 : 1) + PROMPT_PALETTE_TABS.length) % PROMPT_PALETTE_TABS.length])
        return
      }

      if (event.key === 'Enter' && paletteEntries.length > 0) {
        event.preventDefault()
        handleInsertPaletteEntry(paletteEntries[paletteIndex] ?? paletteEntries[0], event.shiftKey)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        // Ctrl+Space / 버튼이 넣은 빈 `@`는 닫을 때 같이 지운다
        if (paletteRange.start === explicitPaletteStart && paletteRange.query === '' && value[paletteRange.start] === '@') {
          const nextValue = replacePromptRange(value, paletteRange.start, paletteRange.start + 1, '')
          setExplicitPaletteStart(null)
          setDismissedSuggestionAt({ value: nextValue, caret: paletteRange.start })
          applyValueWithCaret(nextValue, paletteRange.start)
          return
        }
        setDismissedPaletteStart(paletteRange.start)
        return
      }
    }

    if (isTokenEditorOpen && activeRandomToken && event.key === 'Escape') {
      event.preventDefault()
      setDismissedTokenKey(activeRandomToken.key)
      return
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

    if (isPromptAutocompleteOpen && !activePromptAutocompleteCharacter && promptAutocompleteSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setPromptAutocompleteIndex((current) => (current + 1) % promptAutocompleteSuggestions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setPromptAutocompleteIndex((current) => (current <= 0 ? promptAutocompleteSuggestions.length : current) - 1)
        return
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && promptAutocompleteIndex >= 0) {
        event.preventDefault()
        handleInsertPromptAutocomplete(promptAutocompleteSuggestions[promptAutocompleteIndex] ?? promptAutocompleteSuggestions[0])
        return
      }
    }

    if (isPromptAutocompleteOpen && event.key === 'Escape') {
      event.preventDefault()
      setDismissedSuggestionAt({ value, caret: caretPosition })
      setSelectedPromptAutocompleteCharacter(null)
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
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? errorMessageId : undefined,
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
      }, 120)
    },
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

  // 랜덤 토큰이 있으면 textarea 글자를 투명하게 하고 덮개 레이어가 글자와 칩을 그린다
  const isChipMode = randomTokens.length > 0
  const hasOverlay = isChipMode || (showDetectedSyntax && detectedTokens.length > 0)
  const overlayContent = isChipMode
    ? renderPromptFieldOverlay(value, showDetectedSyntax ? detectedTokens : [], randomTokens, getTokenStatus, isTokenEditorOpen ? activeRandomToken?.key ?? null : null)
    : renderPromptSyntaxOverlay(value, detectedTokens)
  const overlayTextClass = isChipMode ? 'text-foreground' : 'text-transparent'
  const fieldLayerClass = hasOverlay ? cn('relative z-10 bg-transparent', isChipMode && 'text-transparent caret-foreground') : 'relative z-10'

  useLayoutEffect(() => {
    const field = fieldRef.current
    const overlay = overlayRef.current
    if (!field || !overlay) return
    const sync = () => syncPromptOverlayStyle(field, overlay)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(field)
    return () => observer.disconnect()
  })

  return (
    <div ref={rootRef} className="relative space-y-2">
      <div className={cn('relative rounded-sm', hasOverlay ? 'bg-surface-container' : undefined)}>
        {hasOverlay ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm">
            {multiline ? (
              <div
                ref={overlayRef}
                className={cn('absolute inset-0', overlayTextClass)}
                style={{ transform: `translate(${-fieldScrollLeft}px, ${-fieldScrollTop}px)` }}
              >
                {overlayContent}
              </div>
            ) : (
              <div ref={overlayRef} className={cn('flex h-full items-center overflow-hidden', overlayTextClass)}>
                <div
                  className="min-w-full whitespace-pre"
                  style={{ transform: `translateX(${-fieldScrollLeft}px)` }}
                >
                  {overlayContent}
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
            className={cn(textareaVariants(), 'overflow-hidden pr-10', fieldLayerClass, className)}
          />
        ) : (
          <input
            ref={(node) => {
              fieldRef.current = node
            }}
            type="text"
            {...sharedProps}
            className={cn(inputVariants(), fieldLayerClass, className)}
          />
        )}

        {multiline && !disabled ? (
          <div className="absolute top-1 right-1 z-20 flex flex-col gap-1">
            <IconButton
              size="icon-xs"
              variant="ghost"
              label={t({ ko: '랜덤 소스 팔레트 (@, Ctrl+Space)', en: 'Random source palette (@, Ctrl+Space)' })}
              onMouseDown={(event) => {
                event.preventDefault()
                openPaletteAtCaret(isFocused ? fieldRef.current?.selectionStart ?? value.length : value.length)
              }}
            >
              <AtSign />
            </IconButton>
            {canViewWildcards ? (
              <IconButton
                size="icon-xs"
                variant={isRollPreviewOpen ? 'secondary' : 'ghost'}
                aria-pressed={isRollPreviewOpen}
                label={t({ ko: '실제로 들어갈 프롬프트 미리보기', en: 'Preview resolved prompts' })}
                onClick={() => setIsRollPreviewOpen((current) => !current)}
              >
                <Dices />
              </IconButton>
            ) : null}
          </div>
        ) : null}
      </div>

      {legacyConversion.count > 0 || legacyUndo ? (
        <div className="flex items-center justify-between gap-2 rounded-sm bg-primary/8 px-3 py-1.5 text-xs">
          <span>
            {legacyUndo
              ? t({ ko: `예전 문법 ${legacyUndo.count}곳을 새 문법으로 바꿨어요.`, en: `Converted ${legacyUndo.count} old syntax token(s).` })
              : t({ ko: `예전 문법이 ${legacyConversion.count}곳 있어요. 뜻은 그대로 두고 새 문법으로 바꿀 수 있어요.`, en: `${legacyConversion.count} token(s) use the old syntax and can be converted without changing meaning.` })}
          </span>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={async () => {
              if (legacyUndo) {
                onChange(legacyUndo.before)
                setLegacyUndo(null)
                return
              }
              // 다른 탭·기기에서 만든 와일드카드를 태그 그룹으로 바꾸지 않도록, 바꾸기 직전에 목록을 새로 받아 다시 판단한다
              const fresh = await wildcardsQuery.refetch()
              if (!fresh.isSuccess) {
                return
              }
              const conversion = convertLegacyPromptSyntax(value, createWildcardNameMatcher(flattenWildcardRecords(fresh.data)))
              if (conversion.count === 0) {
                return
              }
              setLegacyUndo({ before: value, after: conversion.value, count: conversion.count })
              onChange(conversion.value)
            }}
          >
            {legacyUndo ? t({ ko: '되돌리기', en: 'Undo' }) : t({ ko: '새 문법으로 바꾸기', en: 'Convert' })}
          </Button>
        </div>
      ) : null}

      {missingTokens.length > 0 ? (
        <div className="space-y-1 px-1 text-xs text-destructive">
          {missingTokens.map(({ token, status }) => (
            <div key={token.key} className="flex flex-wrap items-center gap-1">
              <span>{t({ ko: `⚠ ${token.name}: 찾을 수 없어 생성할 때 빈 값으로 들어가요.`, en: `⚠ ${token.name}: not found, becomes empty at generation.` })}</span>
              {status.suggestion ? (
                <Button type="button" size="xs" variant="ghost" className="underline" onClick={() => handleRenameRandomToken(token, status.source, status.suggestion ?? token.name)}>
                  {t({ ko: `혹시 ${status.suggestion}?`, en: `Did you mean ${status.suggestion}?` })}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {isRollPreviewOpen && canViewWildcards ? (
        <div className="space-y-1 rounded-sm bg-surface-low px-3 py-2 text-xs">
          <div className="flex items-center justify-between text-2xs text-muted-foreground">
            <span>{t({ ko: '실제로 들어갈 프롬프트 · 예시 3개', en: 'Resolved prompts · 3 samples' })}</span>
            <Button type="button" size="xs" variant="ghost" onClick={() => setRollNonce((current) => current + 1)}>
              {t({ ko: '다시 굴리기', en: 'Roll again' })}
            </Button>
          </div>
          {!value.trim() ? (
            <div className="text-muted-foreground">{t({ ko: '프롬프트를 입력하면 미리 굴려볼 수 있어요.', en: 'Type a prompt to preview it.' })}</div>
          ) : rollPreviewQuery.isLoading ? (
            <div className="text-muted-foreground">{t({ ko: '굴리는 중…', en: 'Rolling…' })}</div>
          ) : rollPreviewQuery.isError ? (
            <div className="text-destructive">{t({ ko: '미리보기를 불러오지 못했어요.', en: 'Could not load the preview.' })}</div>
          ) : (
            (rollPreviewQuery.data?.results ?? []).map((result, index) => (
              <div key={index} className="border-t border-line pt-1 break-words first:border-t-0 first:pt-0">{result}</div>
            ))
          )}
        </div>
      ) : null}

      <WildcardInlinePickerDetectedChips
        showDetectedSyntax={showDetectedSyntax}
        detectedTokenSummaries={detectedTokenSummaries}
        activeDetectedTokenKey={activeDetectedTokenKey}
        detectedTokenButtonRefs={detectedTokenButtonRefs}
        detectedCharacters={detectedCharacters}
        activeDetectedCharacterKey={activeDetectedCharacterKey}
        detectedCharacterButtonRefs={detectedCharacterButtonRefs}
        onCancelDetectedPopupClose={cancelDetectedPopupClose}
        onScheduleDetectedPopupClose={scheduleDetectedPopupClose}
        onSetActiveDetectedTokenKey={setActiveDetectedTokenKey}
        onSetActiveDetectedCharacterKey={setActiveDetectedCharacterKey}
      />

      {showDetectedSyntax && activeDetectedToken && detectedPopupPosition ? (
        <PromptSyntaxTokenPopup
          token={activeDetectedToken}
          tool={tool}
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
          activeIndex={promptAutocompleteIndex}
          activeCharacter={activePromptAutocompleteCharacter}
          isLoading={isPromptAutocompleteLoading}
          onSelect={handleInsertPromptAutocomplete}
          onSelectRelatedTag={handleInsertPromptRelatedTag}
        />
      ) : null}

      {isPaletteOpen && inlinePopupPosition ? (
        <WildcardInlinePickerPopup position={inlinePopupPosition}>
          <PromptRandomPalette
            tab={paletteTab}
            entries={paletteEntries}
            recents={paletteRecents}
            activeIndex={paletteIndex}
            isLoading={isRandomSourcesLoading || wildcardsQuery.isLoading}
            tool={tool}
            promptType={autocompletePromptType}
            onChangeTab={setPaletteTab}
            onHoverIndex={setPaletteIndex}
            onInsert={handleInsertPaletteEntry}
          />
        </WildcardInlinePickerPopup>
      ) : null}

      {isTokenEditorOpen && activeRandomToken && inlinePopupPosition ? (
        <WildcardInlinePickerPopup position={{ ...inlinePopupPosition, width: Math.min(inlinePopupPosition.width, 360) }}>
          <PromptRandomTokenEditor
            token={activeRandomToken}
            status={getTokenStatus(activeRandomToken)}
            tool={tool}
            promptType={randomPromptKind}
            canPreview={canViewWildcards}
            onChange={handleChangeRandomToken}
            onRemove={handleRemoveRandomToken}
            onRename={(name) => handleRenameRandomToken(activeRandomToken, getTokenStatus(activeRandomToken).source, name)}
          />
        </WildcardInlinePickerPopup>
      ) : null}

      {isPopupOpen && inlinePopupPosition ? (
        <WildcardInlinePickerPopup position={inlinePopupPosition}>
          <WildcardInlinePickerPopupContent
            activeIndex={activeIndex}
            activeListSuggestions={indexedSuggestions}
            normalizedActiveQuery={normalizedActiveQuery}
            tool={tool}
            onInsertPreprocess={handleInsertPreprocess}
          />
        </WildcardInlinePickerPopup>
      ) : null}
    </div>
  )
}
