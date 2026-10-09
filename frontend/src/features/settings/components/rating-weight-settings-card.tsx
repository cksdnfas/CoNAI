import { useMemo, useState, type ReactNode } from 'react'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import type { RatingTierRecord } from '@/features/search/search-types'
import type { RatingWeightsRecord } from '@/lib/api-settings'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { LoadingState } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { ChatFilledLabel } from './settings-filled-label'
import { SETTINGS_CONTROL_CLASS } from './settings-rows'

interface RatingWeightSettingsCardProps {
  heading: ReactNode
  actions?: ReactNode
  ratingWeightsDraft: RatingWeightsRecord | null
  ratingTiersDraft: RatingTierRecord[] | null
  validationMessages: string[]
  onPatchRatingWeights: (
    patch: Partial<Pick<RatingWeightsRecord, 'general_weight' | 'sensitive_weight' | 'questionable_weight' | 'explicit_weight'>>,
  ) => void
}

interface RatingPreviewState {
  general: number
  sensitive: number
  questionable: number
  explicit: number
}

const DEFAULT_PREVIEW_STATE: RatingPreviewState = {
  general: 0.9,
  sensitive: 0.07,
  questionable: 0.02,
  explicit: 0.01,
}

export function RatingWeightSettingsCard({
  heading,
  actions,
  ratingWeightsDraft,
  ratingTiersDraft,
  validationMessages,
  onPatchRatingWeights,
}: RatingWeightSettingsCardProps) {
  const { t, formatNumber } = useI18n()
  const [previewState, setPreviewState] = useState<RatingPreviewState>(DEFAULT_PREVIEW_STATE)

  const previewResult = useMemo(() => {
    if (!ratingWeightsDraft) {
      return null
    }

    const score =
      previewState.general * ratingWeightsDraft.general_weight +
      previewState.sensitive * ratingWeightsDraft.sensitive_weight +
      previewState.questionable * ratingWeightsDraft.questionable_weight +
      previewState.explicit * ratingWeightsDraft.explicit_weight

    const tier = ratingTiersDraft?.find((candidate) => (
      score >= candidate.min_score && (candidate.max_score === null || score < candidate.max_score)
    )) ?? null

    return { score, tier }
  }, [previewState, ratingTiersDraft, ratingWeightsDraft])

  const handlePreviewPatch = (key: keyof RatingPreviewState, rawValue: string) => {
    const nextValue = Number(rawValue)
    setPreviewState((current) => ({
      ...current,
      [key]: Number.isFinite(nextValue) ? Math.max(0, nextValue) : 0,
    }))
  }

  const weightFields = [
    { key: 'general_weight', label: t({ ko: 'General 가중치', en: 'General weight' }) },
    { key: 'sensitive_weight', label: t({ ko: 'Sensitive 가중치', en: 'Sensitive weight' }) },
    { key: 'questionable_weight', label: t({ ko: 'Questionable 가중치', en: 'Questionable weight' }) },
    { key: 'explicit_weight', label: t({ ko: 'Explicit 가중치', en: 'Explicit weight' }) },
  ] as const
  const previewFields = [
    { key: 'general', label: t({ ko: 'General 점수', en: 'General score' }) },
    { key: 'sensitive', label: t({ ko: 'Sensitive 점수', en: 'Sensitive score' }) },
    { key: 'questionable', label: t({ ko: 'Questionable 점수', en: 'Questionable score' }) },
    { key: 'explicit', label: t({ ko: 'Explicit 점수', en: 'Explicit score' }) },
  ] as const

  return (
    <div className="space-y-8">
      <RowGroup heading={heading} actions={actions}>
        {validationMessages.length > 0 ? (
          <div className="mb-2 rounded-sm bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">
            <div className="font-medium">{t({ ko: '저장 전에 확인해줘', en: 'Check before saving' })}</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
              {validationMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {ratingWeightsDraft ? (
          weightFields.map((field) => (
            <SettingRow key={field.key} label={<ChatFilledLabel fieldId={`ratingWeights.${field.key}`}>{field.label}</ChatFilledLabel>} controlClassName={SETTINGS_CONTROL_CLASS}>
              <NumberStepperInput
                min={0}
                step={0.1}
                variant="settings"
                aria-label={field.label}
                value={ratingWeightsDraft[field.key]}
                onValueCommit={(value) => onPatchRatingWeights({ [field.key]: Number(value) || 0 })}
              />
            </SettingRow>
          ))
        ) : (
          <LoadingState label={t({ ko: '평가 가중치를 불러오는 중…', en: 'Loading rating weights…' })} />
        )}
      </RowGroup>

      {ratingWeightsDraft ? (
        <RowGroup heading={t({ ko: '점수 미리보기', en: 'Score preview' })}>
          {previewFields.map((field) => (
            <SettingRow key={field.key} label={field.label} controlClassName={SETTINGS_CONTROL_CLASS}>
              <NumberStepperInput min={0} step={0.01} variant="settings" aria-label={field.label} value={previewState[field.key]} onValueCommit={(value) => handlePreviewPatch(field.key, value)} />
            </SettingRow>
          ))}
          <SettingRow label={t({ ko: '예상 총점', en: 'Estimated total' })}>
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {previewResult ? formatNumber(previewResult.score, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : '—'}
            </span>
          </SettingRow>
          <SettingRow label={t({ ko: '예상 등급', en: 'Estimated tier' })}>
            {previewResult?.tier ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {previewResult.tier.min_score}~{previewResult.tier.max_score === null ? '∞' : previewResult.tier.max_score}
              </span>
            ) : null}
            <span
              className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold"
              style={previewResult?.tier?.color
                ? {
                    color: previewResult.tier.color,
                    borderColor: previewResult.tier.color,
                    backgroundColor: `color-mix(in srgb, ${previewResult.tier.color} 16%, transparent)`,
                  }
                : undefined}
            >
              {previewResult?.tier?.tier_name ?? t({ ko: '매칭 없음', en: 'No match' })}
            </span>
          </SettingRow>
        </RowGroup>
      ) : null}
    </div>
  )
}
