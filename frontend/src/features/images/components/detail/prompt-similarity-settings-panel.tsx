import { Settings2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PromptSimilaritySettingsDraft } from './image-detail-utils'
import { DetailSettingsFlyout, detailSettingsLabelClassName } from './detail-settings-flyout'

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
  return (
    <div className="space-y-4">
      <DetailSettingsFlyout
        isOpen={isOpen && Boolean(draft)}
        onToggle={onToggle}
        triggerLabel={isOpen ? '텍스트 유사도 설정 닫기' : '텍스트 유사도 설정 열기'}
        triggerTitle="텍스트 유사도 설정"
        panelWidthClassName="w-[min(30rem,calc(100vw-2rem))]"
        icon={<Settings2 className="h-4 w-4" />}
      >
        {draft ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className={detailSettingsLabelClassName}>Result Limit</label>
                <Input type="number" min={1} max={100} variant="detail" value={draft.resultLimit} onChange={(event) => onPatchDraft({ resultLimit: Number(event.target.value) })} />
              </div>

              <div className="space-y-2">
                <label className={detailSettingsLabelClassName}>Combined Threshold</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={draft.combinedThreshold}
                    onChange={(event) => onPatchDraft({ combinedThreshold: Number(event.target.value) })}
                    className="w-full"
                  />
                  <span className="w-10 text-right text-sm text-foreground">{draft.combinedThreshold}</span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                <h3 className="text-sm font-semibold text-foreground">가중치</h3>

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Positive</label>
                  <Input type="number" min={0} max={100} step={0.1} variant="detailNested" value={draft.weights.positive} onChange={(event) => onPatchDraft({ weights: { ...draft.weights, positive: Number(event.target.value) } })} />
                </div>

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Negative</label>
                  <Input type="number" min={0} max={100} step={0.1} variant="detailNested" value={draft.weights.negative} onChange={(event) => onPatchDraft({ weights: { ...draft.weights, negative: Number(event.target.value) } })} />
                </div>

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Auto</label>
                  <Input type="number" min={0} max={100} step={0.1} variant="detailNested" value={draft.weights.auto} onChange={(event) => onPatchDraft({ weights: { ...draft.weights, auto: Number(event.target.value) } })} />
                </div>
              </div>

              <div className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                <h3 className="text-sm font-semibold text-foreground">필드 임계값</h3>

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Positive</label>
                  <Input type="number" min={0} max={100} variant="detailNested" value={draft.fieldThresholds.positive} onChange={(event) => onPatchDraft({ fieldThresholds: { ...draft.fieldThresholds, positive: Number(event.target.value) } })} />
                </div>

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Negative</label>
                  <Input type="number" min={0} max={100} variant="detailNested" value={draft.fieldThresholds.negative} onChange={(event) => onPatchDraft({ fieldThresholds: { ...draft.fieldThresholds, negative: Number(event.target.value) } })} />
                </div>

                <div className="space-y-2">
                  <label className={detailSettingsLabelClassName}>Auto</label>
                  <Input type="number" min={0} max={100} variant="detailNested" value={draft.fieldThresholds.auto} onChange={(event) => onPatchDraft({ fieldThresholds: { ...draft.fieldThresholds, auto: Number(event.target.value) } })} />
                </div>
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
          <AlertTitle>텍스트 유사도 설정을 저장하지 못했어</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
