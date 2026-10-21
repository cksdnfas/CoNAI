import type { Dispatch, RefObject, SetStateAction } from 'react'
import { ToggleChip } from '@/components/ui/chip'
import { useI18n } from '@/i18n'
import { getPromptSyntaxKindLabel, type PromptSyntaxToken } from './prompt-syntax-highlight-helpers'
import type { PromptAutocompleteSuggestion, PromptDetectedCharacterCandidate } from './use-prompt-inline-autocomplete'
import { getPromptSyntaxChipTone } from './wildcard-inline-picker-field-ui'

interface DetectedCharacterSummary {
  candidate: PromptDetectedCharacterCandidate
  suggestion: PromptAutocompleteSuggestion
}

interface WildcardInlinePickerDetectedChipsProps {
  showDetectedSyntax: boolean
  detectedTokenSummaries: PromptSyntaxToken[]
  activeDetectedTokenKey: string | null
  detectedTokenButtonRefs: RefObject<Map<string, HTMLButtonElement | null>>
  detectedCharacters: DetectedCharacterSummary[]
  activeDetectedCharacterKey: string | null
  detectedCharacterButtonRefs: RefObject<Map<string, HTMLButtonElement | null>>
  onCancelDetectedPopupClose: () => void
  onScheduleDetectedPopupClose: () => void
  onSetActiveDetectedTokenKey: Dispatch<SetStateAction<string | null>>
  onSetActiveDetectedCharacterKey: Dispatch<SetStateAction<string | null>>
}

export function WildcardInlinePickerDetectedChips({
  showDetectedSyntax,
  detectedTokenSummaries,
  activeDetectedTokenKey,
  detectedTokenButtonRefs,
  detectedCharacters,
  activeDetectedCharacterKey,
  detectedCharacterButtonRefs,
  onCancelDetectedPopupClose,
  onScheduleDetectedPopupClose,
  onSetActiveDetectedTokenKey,
  onSetActiveDetectedCharacterKey,
}: WildcardInlinePickerDetectedChipsProps) {
  const { t } = useI18n()

  return (
    <>
      {showDetectedSyntax && detectedTokenSummaries.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-2xs text-muted-foreground">
          <span>{t('image-generation.components.wildcard.inline.picker.field.detected')}</span>
          {detectedTokenSummaries.map((token) => {
            const isActive = token.key === activeDetectedTokenKey
            return (
              <ToggleChip
                key={token.key}
                ref={(node: HTMLButtonElement | null) => {
                  detectedTokenButtonRefs.current.set(token.key, node)
                }}
                type="button"
                size="sm"
                tone={getPromptSyntaxChipTone(token.kind)}
                pressed={isActive}
                onMouseEnter={() => {
                  onCancelDetectedPopupClose()
                  onSetActiveDetectedTokenKey(token.key)
                }}
                onMouseLeave={() => {
                  onScheduleDetectedPopupClose()
                }}
                onFocus={() => {
                  onCancelDetectedPopupClose()
                  onSetActiveDetectedTokenKey(token.key)
                }}
                onBlur={() => {
                  onScheduleDetectedPopupClose()
                }}
                onClick={() => {
                  onCancelDetectedPopupClose()
                  onSetActiveDetectedTokenKey((current) => current === token.key ? null : token.key)
                }}
              >
                <span className="max-w-[12rem] truncate">{token.kind === 'comment' ? t('image-generation.components.wildcard.inline.picker.field.comment.items', { count: token.count }) : token.rawText}</span>
                <span className="opacity-75">{getPromptSyntaxKindLabel(token.kind)}</span>
                {token.count > 1 ? <span className="font-semibold tabular-nums">×{token.count}</span> : null}
              </ToggleChip>
            )
          })}
        </div>
      ) : null}

      {showDetectedSyntax && detectedCharacters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-2xs text-muted-foreground">
          <span>{t({ ko: '캐릭터', en: 'Characters' })}</span>
          {detectedCharacters.map(({ candidate, suggestion }) => {
            const isActive = candidate.key === activeDetectedCharacterKey
            return (
              <ToggleChip
                key={candidate.key}
                ref={(node: HTMLButtonElement | null) => {
                  detectedCharacterButtonRefs.current.set(candidate.key, node)
                }}
                type="button"
                size="sm"
                pressed={isActive}
                onClick={() => {
                  onSetActiveDetectedCharacterKey((current) => current === candidate.key ? null : candidate.key)
                }}
              >
                <span className="max-w-[12rem] truncate">{suggestion.label}</span>
                {suggestion.translatedName ? <span className="max-w-[8rem] truncate text-muted-foreground">{suggestion.translatedName}</span> : null}
                {suggestion.relatedTags?.length ? <span className="font-semibold tabular-nums text-muted-foreground">{suggestion.relatedTags.length}</span> : null}
              </ToggleChip>
            )
          })}
        </div>
      ) : null}
    </>
  )
}
