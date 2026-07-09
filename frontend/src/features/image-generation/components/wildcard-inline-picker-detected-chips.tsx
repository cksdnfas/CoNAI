import type { Dispatch, RefObject, SetStateAction } from 'react'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { getPromptSyntaxKindLabel, type PromptSyntaxToken } from './prompt-syntax-highlight-helpers'
import type { PromptAutocompleteSuggestion, PromptDetectedCharacterCandidate } from './use-prompt-inline-autocomplete'
import { getPromptSyntaxChipClass } from './wildcard-inline-picker-field-ui'

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
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-[11px] text-muted-foreground">
          <span>{t('image-generation.components.wildcard.inline.picker.field.detected')}</span>
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
                <span className="text-muted-foreground">{getPromptSyntaxKindLabel(token.kind)}</span>
                {token.count > 1 ? <Badge variant="secondary">{token.count}</Badge> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {showDetectedSyntax && detectedCharacters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-[11px] text-muted-foreground">
          <span>{t({ ko: '캐릭터', en: 'Characters' })}</span>
          {detectedCharacters.map(({ candidate, suggestion }) => {
            const isActive = candidate.key === activeDetectedCharacterKey
            return (
              <button
                key={candidate.key}
                ref={(node) => {
                  detectedCharacterButtonRefs.current.set(candidate.key, node)
                }}
                type="button"
                className={cn(
                  'inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors',
                  isActive ? 'border-cyan-300/60 bg-cyan-400/18 text-foreground' : 'border-cyan-400/20 bg-cyan-400/10 text-foreground/90 hover:bg-cyan-400/16',
                )}
                onClick={() => {
                  onSetActiveDetectedCharacterKey((current) => current === candidate.key ? null : candidate.key)
                }}
              >
                <span className="max-w-[12rem] truncate">{suggestion.label}</span>
                {suggestion.translatedName ? <span className="max-w-[8rem] truncate text-muted-foreground">{suggestion.translatedName}</span> : null}
                {suggestion.relatedTags?.length ? <Badge variant="secondary">{suggestion.relatedTags.length}</Badge> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </>
  )
}
