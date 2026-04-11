import { Settings2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { SIMILARITY_RESULT_ROW_MAX, SIMILARITY_RESULT_ROW_MIN, type SimilaritySettingsDraft } from './image-detail-utils'
import { DetailSettingsFlyout, detailSettingsLabelClassName } from './detail-settings-flyout'

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
  return (
    <div className="space-y-4">
      <DetailSettingsFlyout
        isOpen={isOpen && Boolean(draft)}
        onToggle={onToggle}
        triggerLabel={isOpen ? '이미지 유사도 설정 닫기' : '이미지 유사도 설정 열기'}
        triggerTitle="이미지 유사도 설정"
        panelWidthClassName="w-[min(32rem,calc(100vw-2rem))]"
        icon={<Settings2 className="h-4 w-4" />}
      >
        {draft ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <SimilarityNumberField
                label="표시 줄 수"
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
                <span>비슷한 해상도만 우선 보기</span>
              </label>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-sm border border-border bg-surface-container/70 p-3">
                <h3 className="text-sm font-semibold text-foreground">혼합 비중</h3>

                <SimilarityNumberField
                  label="pHash 비중"
                  min={0}
                  max={100}
                  value={draft.detailSimilarWeights.perceptualHash}
                  onChange={(value) => onPatchDraft({ detailSimilarWeights: { ...draft.detailSimilarWeights, perceptualHash: value } })}
                />

                <SimilarityNumberField
                  label="dHash 비중"
                  min={0}
                  max={100}
                  value={draft.detailSimilarWeights.dHash}
                  onChange={(value) => onPatchDraft({ detailSimilarWeights: { ...draft.detailSimilarWeights, dHash: value } })}
                />

                <SimilarityNumberField
                  label="aHash 비중"
                  min={0}
                  max={100}
                  value={draft.detailSimilarWeights.aHash}
                  onChange={(value) => onPatchDraft({ detailSimilarWeights: { ...draft.detailSimilarWeights, aHash: value } })}
                />

                <SimilarityNumberField
                  label="색상 비중"
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
                <h3 className="text-sm font-semibold text-foreground">항목별 허용 범위</h3>

                <SimilarityNumberField
                  label="pHash 허용 거리"
                  min={0}
                  max={64}
                  value={draft.detailSimilarThresholds.perceptualHash}
                  onChange={(value) => onPatchDraft({
                    detailSimilarThreshold: value,
                    detailSimilarThresholds: { ...draft.detailSimilarThresholds, perceptualHash: value },
                  })}
                />

                <SimilarityNumberField
                  label="dHash 허용 거리"
                  min={0}
                  max={64}
                  value={draft.detailSimilarThresholds.dHash}
                  onChange={(value) => onPatchDraft({ detailSimilarThresholds: { ...draft.detailSimilarThresholds, dHash: value } })}
                />

                <SimilarityNumberField
                  label="aHash 허용 거리"
                  min={0}
                  max={64}
                  value={draft.detailSimilarThresholds.aHash}
                  onChange={(value) => onPatchDraft({ detailSimilarThresholds: { ...draft.detailSimilarThresholds, aHash: value } })}
                />

                <SimilarityNumberField
                  label="색상 최소 유사도"
                  min={0}
                  max={100}
                  value={draft.detailSimilarThresholds.color}
                  onChange={(value) => onPatchDraft({
                    detailSimilarIncludeColorSimilarity: value > 0 || draft.detailSimilarWeights.color > 0,
                    detailSimilarThresholds: { ...draft.detailSimilarThresholds, color: value },
                  })}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={onToggle}>
                닫기
              </Button>
              <Button size="sm" onClick={onApply} disabled={isSaving}>
                {isSaving ? '저장 중…' : '적용'}
              </Button>
            </div>
          </div>
        ) : null}
      </DetailSettingsFlyout>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>유사 이미지 설정을 저장하지 못했어</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
