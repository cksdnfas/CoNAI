import type { ChatJudgeItemResult, ChatJudgeOutcome, ChatJudgeRunStage } from '@conai/shared'
import { Chip } from '@/components/ui/chip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type T = ReturnType<typeof useI18n>['t']

/** The verdict as a chip: 예 / 아니오 / 애매, or 실패 when the judge gave no answer. */
export function JudgeVerdictChip({ result, className }: { result: Pick<ChatJudgeItemResult, 'verdict' | 'decidedBy'>; className?: string }) {
  const { t } = useI18n()
  if (result.decidedBy === 'fallback') return <Chip size="sm" tone="destructive" className={className}>{t({ ko: '실패', en: 'Failed' })}</Chip>
  const tone = result.verdict === 'yes' ? 'success' : result.verdict === 'no' ? 'warning' : 'muted'
  const label = result.verdict === 'yes' ? t({ ko: '예', en: 'Yes' }) : result.verdict === 'no' ? t({ ko: '아니오', en: 'No' }) : t({ ko: '애매', en: 'Unsure' })
  return <Chip size="sm" tone={tone} className={className}>{label}</Chip>
}

/**
 * The probability of yes as a bar, with the item's two thresholds as ticks when they are known.
 * Null (the judge failed) draws an empty track.
 */
export function JudgeProbabilityBar({ probability, yesThreshold, noThreshold, className }: { probability: number | null; yesThreshold?: number; noThreshold?: number; className?: string }) {
  const value = probability ?? 0
  const tone = yesThreshold !== undefined && value >= yesThreshold ? 'bg-success' : noThreshold !== undefined && value <= noThreshold ? 'bg-warning' : 'bg-muted-foreground/60'
  return (
    <span className={cn('relative block h-1.5 w-full overflow-hidden rounded-full bg-foreground/10', className)} aria-hidden="true">
      {probability === null ? null : <span className={cn('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${Math.round(value * 100)}%` }} />}
      {noThreshold !== undefined ? <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${noThreshold * 100}%` }} /> : null}
      {yesThreshold !== undefined ? <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${yesThreshold * 100}%` }} /> : null}
    </span>
  )
}

export function formatProbability(value: number | null) {
  return value === null ? '—' : value.toFixed(2)
}

/** What the turn did with an answer, in a few words. */
export function judgeActionLabel(result: Pick<ChatJudgeItemResult, 'action' | 'decidedBy' | 'verdict'>, t: T) {
  if (result.decidedBy === 'fallback') return t({ ko: '판단 없이 진행', en: 'Went on unjudged' })
  switch (result.action) {
    case 'offered': return t({ ko: '도구·지시문 붙임', en: 'Tools kept, directive added' })
    case 'withheld': return t({ ko: '도구 뺌', en: 'Tools withheld' })
    case 'follow-up': return t({ ko: '후속 메시지', en: 'Follow-up' })
    case 'route': return t({ ko: '답할 사람 정함', en: 'Picked who answers' })
    case 'next': return t({ ko: '이어 말하게 함', en: 'Spoke on' })
    case 'wait': return t({ ko: '사용자 차례', en: 'Waited for the user' })
    case 'set': return t({ ko: '필드 바꿈', en: 'Field set' })
    case 'lore': return t({ ko: '로어 넣음', en: 'Lore added' })
    case 'recall': return t({ ko: '회상 남김', en: 'Recall kept' })
    case 'drop': return t({ ko: '회상 뺌', en: 'Recall dropped' })
    default: return result.verdict === 'uncertain' ? t({ ko: '지금 방식', en: 'As usual' }) : t({ ko: '동작 없음', en: 'No action' })
  }
}

/** What a run judged, in a word or two. */
export function judgeStageLabel(stage: ChatJudgeRunStage, t: T) {
  switch (stage) {
    case 'before': return t({ ko: '답변 전', en: 'before' })
    case 'after': return t({ ko: '답변 후', en: 'after' })
    case 'route': return t({ ko: '답할 사람', en: 'who answers' })
    case 'next': return t({ ko: '이어 말하기', en: 'speaking on' })
    case 'fields': return t({ ko: '상태 필드', en: 'status fields' })
    case 'asset': return t({ ko: '표정 검수', en: 'expression' })
  }
}

/** Who settled an answer, when it was not the judge itself. */
export function judgeDecidedByLabel(result: Pick<ChatJudgeItemResult, 'decidedBy'>, t: T) {
  if (result.decidedBy === 'llm') return t({ ko: 'LLM 재판단', en: 'LLM re-judged' })
  if (result.decidedBy === 'setting') return t({ ko: '애매 설정', en: 'Unsure setting' })
  return null
}

/** What came of an answer, or null when there is nothing to tell. */
export function judgeOutcomeLabel(outcome: ChatJudgeOutcome, t: T) {
  if (outcome.lore === 'saved') return { label: t({ ko: '로어 저장됨', en: 'Lore saved' }), tone: 'success' as const }
  if (outcome.lore === 'dismissed') return { label: t({ ko: '로어 버려짐', en: 'Lore dismissed' }), tone: 'warning' as const }
  if (outcome.lore === 'proposed') return { label: t({ ko: '로어 제안', en: 'Lore proposed' }), tone: 'info' as const }
  if (outcome.lore === 'none') return { label: t({ ko: '제안 안 함', en: 'Not proposed' }), tone: 'muted' as const }
  if (outcome.followUp === 'answered') return { label: t({ ko: '사용자 응답', en: 'User answered' }), tone: 'success' as const }
  if (outcome.followUp === 'sent') return { label: t({ ko: '후속 보냄', en: 'Follow-up sent' }), tone: 'info' as const }
  if (outcome.followUp === 'none') return { label: t({ ko: '후속 안 보냄', en: 'No follow-up' }), tone: 'muted' as const }
  if (outcome.toolUsed === true) return { label: t({ ko: '도구 사용', en: 'Tool used' }), tone: 'success' as const }
  if (outcome.toolUsed === false) return { label: t({ ko: '도구 안 씀', en: 'Tool unused' }), tone: 'muted' as const }
  return null
}
