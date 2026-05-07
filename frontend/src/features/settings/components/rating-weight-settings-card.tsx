import { useMemo, useState, type ReactNode } from 'react'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import type { RatingTierRecord } from '@/features/search/search-types'
import type { RatingWeightsRecord } from '@/lib/api-settings'
import { SettingsField, SettingsInsetBlock, SettingsSection, SettingsValueTile } from './settings-primitives'
import { useI18n } from '@/i18n'

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

  return (
    <SettingsSection heading={heading} actions={actions}>
      {validationMessages.length > 0 ? (
        <div className="rounded-sm border border-[#ffb4ab]/40 bg-[#93000a]/10 px-3 py-2 text-sm text-[#ffb4ab]">
          <div className="font-medium">{t({ ko: '저장 전에 확인해줘', en: 'Check before saving' })}</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
            {validationMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {ratingWeightsDraft ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SettingsField label={t({ ko: 'General 가중치', en: 'General weight' })}>
              <ScrubbableNumberInput
                min={0}
                step={0.1}
                variant="settings"
                value={ratingWeightsDraft.general_weight}
                onChange={(value) => onPatchRatingWeights({ general_weight: Number(value) || 0 })}
              />
            </SettingsField>

            <SettingsField label={t({ ko: 'Sensitive 가중치', en: 'Sensitive weight' })}>
              <ScrubbableNumberInput
                min={0}
                step={0.1}
                variant="settings"
                value={ratingWeightsDraft.sensitive_weight}
                onChange={(value) => onPatchRatingWeights({ sensitive_weight: Number(value) || 0 })}
              />
            </SettingsField>

            <SettingsField label={t({ ko: 'Questionable 가중치', en: 'Questionable weight' })}>
              <ScrubbableNumberInput
                min={0}
                step={0.1}
                variant="settings"
                value={ratingWeightsDraft.questionable_weight}
                onChange={(value) => onPatchRatingWeights({ questionable_weight: Number(value) || 0 })}
              />
            </SettingsField>

            <SettingsField label={t({ ko: 'Explicit 가중치', en: 'Explicit weight' })}>
              <ScrubbableNumberInput
                min={0}
                step={0.1}
                variant="settings"
                value={ratingWeightsDraft.explicit_weight}
                onChange={(value) => onPatchRatingWeights({ explicit_weight: Number(value) || 0 })}
              />
            </SettingsField>
          </div>

          <SettingsInsetBlock className="space-y-3">
            <div className="text-sm font-semibold text-foreground">{t({ ko: 'score 미리보기', en: 'Score preview' })}</div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SettingsField label={t({ ko: 'General 점수', en: 'General score' })}>
                <ScrubbableNumberInput min={0} step={0.01} variant="settings" value={previewState.general} onChange={(value) => handlePreviewPatch('general', value)} />
              </SettingsField>
              <SettingsField label={t({ ko: 'Sensitive 점수', en: 'Sensitive score' })}>
                <ScrubbableNumberInput min={0} step={0.01} variant="settings" value={previewState.sensitive} onChange={(value) => handlePreviewPatch('sensitive', value)} />
              </SettingsField>
              <SettingsField label={t({ ko: 'Questionable 점수', en: 'Questionable score' })}>
                <ScrubbableNumberInput min={0} step={0.01} variant="settings" value={previewState.questionable} onChange={(value) => handlePreviewPatch('questionable', value)} />
              </SettingsField>
              <SettingsField label={t({ ko: 'Explicit 점수', en: 'Explicit score' })}>
                <ScrubbableNumberInput min={0} step={0.01} variant="settings" value={previewState.explicit} onChange={(value) => handlePreviewPatch('explicit', value)} />
              </SettingsField>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <SettingsValueTile label={t({ ko: '예상 총점', en: 'Estimated total' })} value={previewResult ? formatNumber(previewResult.score, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : '—'} valueClassName="text-lg" />
              <SettingsInsetBlock className="space-y-2 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t({ ko: '예상 등급', en: 'Estimated tier' })}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold"
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
                  {previewResult?.tier ? (
                    <span className="text-xs text-muted-foreground">
                      {previewResult.tier.min_score}~{previewResult.tier.max_score === null ? '∞' : previewResult.tier.max_score}
                    </span>
                  ) : null}
                </div>
              </SettingsInsetBlock>
            </div>
          </SettingsInsetBlock>
        </>
      ) : (
        <div className="rounded-sm border border-dashed border-border bg-surface-container px-4 py-6 text-sm text-muted-foreground">
          {t({ ko: '평가 가중치를 불러오는 중…', en: 'Loading rating weights…' })}
        </div>
      )}
    </SettingsSection>
  )
}
