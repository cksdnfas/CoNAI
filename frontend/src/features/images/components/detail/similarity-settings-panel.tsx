import { Settings2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { useI18n } from '@/i18n'
import { SIMILARITY_RESULT_ROW_MAX, SIMILARITY_RESULT_ROW_MIN, type SimilaritySettingsDraft } from './image-detail-utils'
import { DetailSettingsFlyout, detailSettingsLabelClassName } from './detail-settings-flyout'
import { NumberInputWithSuffix, SectionTitleWithTooltip } from './similarity-settings-panel-shared'

interface SimilaritySettingsPanelProps {
  isOpen: boolean
  draft: SimilaritySettingsDraft | null
  isSaving: boolean
  errorMessage: string | null
  onToggle: () => void
  onPatchDraft: (patch: Partial<SimilaritySettingsDraft>) => void
  onApply: () => void
}

interface SimilarityNumberFieldProps {
  label: string
  min: number
  max: number
  step?: number
  value: number
  variant?: 'detail' | 'detailNested'
  onChange: (value: number) => void
}

function SimilarityNumberField({
  label,
  min,
  max,
  step = 1,
  value,
  variant = 'detailNested',
  onChange,
}: SimilarityNumberFieldProps) {
  return (
    <div className="space-y-2">
      <label className={detailSettingsLabelClassName}>{label}</label>
      <ScrubbableNumberInput
        min={min}
        max={max}
        step={step}
        variant={variant}
        value={value}
        onChange={(nextValue) => onChange(Number(nextValue))}
      />
    </div>
  )
}

export function SimilaritySettingsPanel({
  isOpen,
  draft,
  isSaving,
  errorMessage,
  onToggle,
  onPatchDraft,
  onApply,
}: SimilaritySettingsPanelProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      <DetailSettingsFlyout
        isOpen={isOpen && Boolean(draft)}
        onToggle={onToggle}
        triggerLabel={isOpen ? t('images.components.detail.similarity.settings.panel.close.image.similarity.settings') : t('images.components.detail.similarity.settings.panel.open.image.similarity.settings')}
        triggerTitle={t('images.components.detail.similarity.settings.panel.image.similarity.settings')}
        panelWidthClassName="w-[min(32rem,calc(100vw-2rem))]"
        icon={<Settings2 className="h-4 w-4" />}
      >
        {draft ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <SimilarityNumberField
                label={t('images.components.detail.similarity.settings.panel.rows.to.show')}
                min={SIMILARITY_RESULT_ROW_MIN}
                max={SIMILARITY_RESULT_ROW_MAX}
                step={1}
                variant="detail"
                value={draft.detailSimilarLimit}
                onChange={(value) => onPatchDraft({ detailSimilarLimit: value })}
              />

              <label className="flex items-center gap-3 pt-6 text-sm text-foreground sm:pt-7">
                <input
                  type="checkbox"
                  checked={draft.detailSimilarUseMetadataFilter}
                  onChange={(event) => onPatchDraft({ detailSimilarUseMetadataFilter: event.target.checked })}
                  className="h-4 w-4"
                />
                <span>{t('images.components.detail.similarity.settings.panel.prioritize.similar.resolutions.only')}</span>
              </label>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-3">
                <SectionTitleWithTooltip title={t('images.components.detail.similarity.settings.panel.score.weights')} tooltip={t('images.components.detail.similarity.settings.panel.weight.used.in.the.final.score.calculation')} />

                <SimilarityNumberField
                  label={t('images.components.detail.similarity.settings.panel.phash.weight')}
                  min={0}
                  max={100}
                  value={draft.detailSimilarWeights.perceptualHash}
                  onChange={(value) => onPatchDraft({ detailSimilarWeights: { ...draft.detailSimilarWeights, perceptualHash: value } })}
                />

                <SimilarityNumberField
                  label={t('images.components.detail.similarity.settings.panel.dhash.weight')}
                  min={0}
                  max={100}
                  value={draft.detailSimilarWeights.dHash}
                  onChange={(value) => onPatchDraft({ detailSimilarWeights: { ...draft.detailSimilarWeights, dHash: value } })}
                />

                <SimilarityNumberField
                  label={t('images.components.detail.similarity.settings.panel.ahash.weight')}
                  min={0}
                  max={100}
                  value={draft.detailSimilarWeights.aHash}
                  onChange={(value) => onPatchDraft({ detailSimilarWeights: { ...draft.detailSimilarWeights, aHash: value } })}
                />

                <SimilarityNumberField
                  label={t('images.components.detail.similarity.settings.panel.color.weight')}
                  min={0}
                  max={100}
                  value={draft.detailSimilarWeights.color}
                  onChange={(value) => onPatchDraft({
                    detailSimilarIncludeColorSimilarity: value > 0 || draft.detailSimilarThresholds.color > 0,
                    detailSimilarWeights: { ...draft.detailSimilarWeights, color: value },
                  })}
                />
              </div>

              <div className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-3">
                <SectionTitleWithTooltip title={t('images.components.detail.similarity.settings.panel.per.item.thresholds')} tooltip={t('images.components.detail.similarity.settings.panel.each.item.must.fall.within.this.range')} />

                <SimilarityNumberField
                  label={t('images.components.detail.similarity.settings.panel.phash.distance.threshold')}
                  min={0}
                  max={64}
                  value={draft.detailSimilarThresholds.perceptualHash}
                  onChange={(value) => onPatchDraft({
                    detailSimilarThreshold: value,
                    detailSimilarThresholds: { ...draft.detailSimilarThresholds, perceptualHash: value },
                  })}
                />

                <SimilarityNumberField
                  label={t('images.components.detail.similarity.settings.panel.dhash.distance.threshold')}
                  min={0}
                  max={64}
                  value={draft.detailSimilarThresholds.dHash}
                  onChange={(value) => onPatchDraft({ detailSimilarThresholds: { ...draft.detailSimilarThresholds, dHash: value } })}
                />

                <SimilarityNumberField
                  label={t('images.components.detail.similarity.settings.panel.ahash.distance.threshold')}
                  min={0}
                  max={64}
                  value={draft.detailSimilarThresholds.aHash}
                  onChange={(value) => onPatchDraft({ detailSimilarThresholds: { ...draft.detailSimilarThresholds, aHash: value } })}
                />

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>{t('images.components.detail.similarity.settings.panel.minimum.color.similarity')}</label>
                  <NumberInputWithSuffix
                    suffix="%"
                    min={0}
                    max={100}
                    step={1}
                    variant="detailNested"
                    value={draft.detailSimilarThresholds.color}
                    onChange={(nextValue) => onPatchDraft({
                      detailSimilarIncludeColorSimilarity: Number(nextValue) > 0 || draft.detailSimilarWeights.color > 0,
                      detailSimilarThresholds: { ...draft.detailSimilarThresholds, color: Number(nextValue) },
                    })}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={onToggle}>
                {t({ ko: '닫기', en: 'Close' })}
              </Button>
              <Button size="sm" onClick={onApply} disabled={isSaving}>
                {isSaving ? t('images.components.detail.similarity.settings.panel.saving') : t('images.components.detail.similarity.settings.panel.apply')}
              </Button>
            </div>
          </div>
        ) : null}
      </DetailSettingsFlyout>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>{t('images.components.detail.similarity.settings.panel.failed.to.save.similar.image.settings')}</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
