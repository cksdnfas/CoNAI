import { Settings2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { useI18n } from '@/i18n'
import { SIMILARITY_RESULT_ROW_MAX, SIMILARITY_RESULT_ROW_MIN, type PromptSimilaritySettingsDraft } from './image-detail-utils'
import { DetailSettingsFlyout, detailSettingsLabelClassName } from './detail-settings-flyout'
import { NumberInputWithSuffix, SectionTitleWithTooltip } from './similarity-settings-panel-shared'

interface PromptSimilaritySettingsPanelProps {
  isOpen: boolean
  draft: PromptSimilaritySettingsDraft | null
  isSaving: boolean
  errorMessage: string | null
  onToggle: () => void
  onPatchDraft: (patch: Partial<PromptSimilaritySettingsDraft>) => void
  onApply: () => void
}

export function PromptSimilaritySettingsPanel({
  isOpen,
  draft,
  isSaving,
  errorMessage,
  onToggle,
  onPatchDraft,
  onApply,
}: PromptSimilaritySettingsPanelProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      <DetailSettingsFlyout
        isOpen={isOpen && Boolean(draft)}
        onToggle={onToggle}
        triggerLabel={isOpen ? t('images.components.detail.prompt.similarity.settings.panel.text.similarity.settings.close') : t('images.components.detail.prompt.similarity.settings.panel.open.text.similarity.settings')}
        triggerTitle={t('images.components.detail.prompt.similarity.settings.panel.text.similarity.settings')}
        panelWidthClassName="w-[min(30rem,calc(100vw-2rem))]"
        icon={<Settings2 className="h-4 w-4" />}
      >
        {draft ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className={detailSettingsLabelClassName}>{t('images.components.detail.prompt.similarity.settings.panel.rows.to.show')}</label>
                <ScrubbableNumberInput min={SIMILARITY_RESULT_ROW_MIN} max={SIMILARITY_RESULT_ROW_MAX} step={1} variant="detail" value={draft.resultLimit} onChange={(value) => onPatchDraft({ resultLimit: Number(value) })} />
              </div>

              <div className="space-y-2">
                <label className={detailSettingsLabelClassName}>{t('images.components.detail.prompt.similarity.settings.panel.combined.score.threshold')}</label>
                <NumberInputWithSuffix suffix="%" min={0} max={100} step={1} variant="detail" value={draft.combinedThreshold} onChange={(value) => onPatchDraft({ combinedThreshold: Number(value) })} />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-3">
                <SectionTitleWithTooltip title={t('images.components.detail.prompt.similarity.settings.panel.score.weights')} tooltip={t('images.components.detail.prompt.similarity.settings.panel.weight.applied.when.calculating.the.combined.score')} />

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Positive</label>
                  <ScrubbableNumberInput min={0} max={1} step={0.05} variant="detailNested" value={draft.weights.positive} onChange={(value) => onPatchDraft({ weights: { ...draft.weights, positive: Number(value) } })} />
                </div>

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Negative</label>
                  <ScrubbableNumberInput min={0} max={1} step={0.05} variant="detailNested" value={draft.weights.negative} onChange={(value) => onPatchDraft({ weights: { ...draft.weights, negative: Number(value) } })} />
                </div>

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Auto</label>
                  <ScrubbableNumberInput min={0} max={1} step={0.05} variant="detailNested" value={draft.weights.auto} onChange={(value) => onPatchDraft({ weights: { ...draft.weights, auto: Number(value) } })} />
                </div>
              </div>

              <div className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-3">
                <SectionTitleWithTooltip title={t('images.components.detail.prompt.similarity.settings.panel.minimum.field.thresholds')} tooltip={t('images.components.detail.prompt.similarity.settings.panel.each.field.must.meet.or.exceed.this')} />

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Positive</label>
                  <ScrubbableNumberInput min={0} max={100} step={1} variant="detailNested" value={draft.fieldThresholds.positive} onChange={(value) => onPatchDraft({ fieldThresholds: { ...draft.fieldThresholds, positive: Number(value) } })} />
                </div>

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Negative</label>
                  <ScrubbableNumberInput min={0} max={100} step={1} variant="detailNested" value={draft.fieldThresholds.negative} onChange={(value) => onPatchDraft({ fieldThresholds: { ...draft.fieldThresholds, negative: Number(value) } })} />
                </div>

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Auto</label>
                  <ScrubbableNumberInput min={0} max={100} step={1} variant="detailNested" value={draft.fieldThresholds.auto} onChange={(value) => onPatchDraft({ fieldThresholds: { ...draft.fieldThresholds, auto: Number(value) } })} />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={onToggle}>
                {t({ ko: '닫기', en: 'Close' })}
              </Button>
              <Button size="sm" onClick={onApply} disabled={isSaving}>
                {isSaving ? t('images.components.detail.prompt.similarity.settings.panel.saving') : t('images.components.detail.prompt.similarity.settings.panel.apply')}
              </Button>
            </div>
          </div>
        ) : null}
      </DetailSettingsFlyout>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>{t('images.components.detail.prompt.similarity.settings.panel.failed.to.save.text.similarity.settings')}</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
