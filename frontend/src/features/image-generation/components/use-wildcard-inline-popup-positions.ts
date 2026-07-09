import { useEffect, useState, type RefObject } from 'react'
import { resolveFloatingDropdownRectFromRect } from './floating-dropdown-utils'
import {
  getTextFieldCaretClientRect,
  type InlinePickerPopupPosition,
  type PromptSyntaxPopupPosition,
} from './wildcard-inline-picker-field-ui'

type UseWildcardInlinePopupPositionsParams = {
  activeDetectedTokenKey: string | null
  activeDetectedCharacterKey: string | null
  isPopupOpen: boolean
  isPromptAutocompleteOpen: boolean
  rootRef: RefObject<HTMLDivElement | null>
  fieldRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  detectedTokenButtonRefs: RefObject<Map<string, HTMLButtonElement | null>>
  detectedCharacterButtonRefs: RefObject<Map<string, HTMLButtonElement | null>>
  caretPosition: number
  fieldScrollLeft: number
  fieldScrollTop: number
  isTreeExplorerMode: boolean
  suggestionsLength: number
  promptAutocompleteSuggestionsLength: number
  value: string
}

function resolvePromptSyntaxPopupPosition(anchor: HTMLElement): PromptSyntaxPopupPosition {
  const rect = anchor.getBoundingClientRect()
  const viewportPadding = 12
  const popupGap = 8
  const popupWidth = Math.min(300, window.innerWidth - viewportPadding * 2)
  const estimatedPopupHeight = 112
  const shouldOpenAbove = rect.bottom + popupGap + estimatedPopupHeight > window.innerHeight - viewportPadding && rect.top > estimatedPopupHeight + popupGap

  let left = rect.left + rect.width / 2 - popupWidth / 2
  left = Math.max(viewportPadding, Math.min(left, window.innerWidth - viewportPadding - popupWidth))

  return {
    top: shouldOpenAbove ? rect.top - popupGap : rect.bottom + popupGap,
    left,
    width: popupWidth,
    placement: shouldOpenAbove ? 'top' : 'bottom',
  }
}

function resolveTextFieldPopupAnchorRect(field: HTMLInputElement | HTMLTextAreaElement, caretPosition: number) {
  const fieldRect = field.getBoundingClientRect()
  const caretRect = getTextFieldCaretClientRect(field, caretPosition)
  return {
    fieldRect,
    popupAnchorRect: caretRect
      ? {
          left: fieldRect.left,
          top: caretRect.top,
          bottom: caretRect.bottom,
          width: fieldRect.width,
        }
      : fieldRect,
  }
}

export function useWildcardInlinePopupPositions({
  activeDetectedTokenKey,
  activeDetectedCharacterKey,
  isPopupOpen,
  isPromptAutocompleteOpen,
  rootRef,
  fieldRef,
  detectedTokenButtonRefs,
  detectedCharacterButtonRefs,
  caretPosition,
  fieldScrollLeft,
  fieldScrollTop,
  isTreeExplorerMode,
  suggestionsLength,
  promptAutocompleteSuggestionsLength,
  value,
}: UseWildcardInlinePopupPositionsParams) {
  const [detectedPopupPosition, setDetectedPopupPosition] = useState<PromptSyntaxPopupPosition | null>(null)
  const [detectedCharacterPopupPosition, setDetectedCharacterPopupPosition] = useState<InlinePickerPopupPosition | null>(null)
  const [inlinePopupPosition, setInlinePopupPosition] = useState<InlinePickerPopupPosition | null>(null)
  const [promptAutocompletePopupPosition, setPromptAutocompletePopupPosition] = useState<InlinePickerPopupPosition | null>(null)

  useEffect(() => {
    if (!activeDetectedTokenKey || typeof window === 'undefined') {
      setDetectedPopupPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = detectedTokenButtonRefs.current.get(activeDetectedTokenKey)
      setDetectedPopupPosition(anchor ? resolvePromptSyntaxPopupPosition(anchor) : null)
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [activeDetectedTokenKey, detectedTokenButtonRefs])

  useEffect(() => {
    if (!activeDetectedCharacterKey || typeof window === 'undefined') {
      setDetectedCharacterPopupPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = detectedCharacterButtonRefs.current.get(activeDetectedCharacterKey)
      setDetectedCharacterPopupPosition(anchor
        ? resolveFloatingDropdownRectFromRect(anchor.getBoundingClientRect(), {
            minWidth: 280,
            preferredMaxHeight: 220,
            minUsableHeight: 120,
            gap: 8,
          })
        : null)
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [activeDetectedCharacterKey, detectedCharacterButtonRefs])

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

      const { fieldRect, popupAnchorRect } = resolveTextFieldPopupAnchorRect(field, caretPosition)
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
  }, [caretPosition, fieldRef, fieldScrollLeft, fieldScrollTop, isPopupOpen, isTreeExplorerMode, rootRef, suggestionsLength, value])

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

      const { fieldRect, popupAnchorRect } = resolveTextFieldPopupAnchorRect(field, caretPosition)
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
  }, [caretPosition, fieldRef, fieldScrollLeft, fieldScrollTop, isPromptAutocompleteOpen, promptAutocompleteSuggestionsLength, value])

  return {
    detectedPopupPosition,
    detectedCharacterPopupPosition,
    inlinePopupPosition,
    promptAutocompletePopupPosition,
  }
}
