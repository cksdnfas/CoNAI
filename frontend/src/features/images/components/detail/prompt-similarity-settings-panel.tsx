import { Settings2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { PromptSimilaritySettingsDraft } from './image-detail-utils'

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
      <div className="relative">
        <Button size="sm" variant="outline" onClick={onToggle}>
          <Settings2 className="h-4 w-4" />
          텍스트 유사도 설정
        </Button>

        {isOpen && draft ? (
          <div className="absolute right-0 top-12 z-30 w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface-container p-4 shadow-[0_0_32px_rgba(14,14,14,0.28)]">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Result Limit</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.resultLimit}
                    onChange={(event) => onPatchDraft({ resultLimit: Number(event.target.value) })}
                    className="h-10 w-full rounded-sm border border-border bg-surface-high px-3 text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Combined Threshold</label>
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
                <div className="space-y-3 rounded-sm border border-border bg-surface-high p-3">
                  <h3 className="text-sm font-semibold text-foreground">가중치</h3>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Positive</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={draft.weights.positive}
                      onChange={(event) => onPatchDraft({ weights: { ...draft.weights, positive: Number(event.target.value) } })}
                      className="h-10 w-full rounded-sm border border-border bg-surface-container px-3 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Negative</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={draft.weights.negative}
                      onChange={(event) => onPatchDraft({ weights: { ...draft.weights, negative: Number(event.target.value) } })}
                      className="h-10 w-full rounded-sm border border-border bg-surface-container px-3 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Auto</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={draft.weights.auto}
                      onChange={(event) => onPatchDraft({ weights: { ...draft.weights, auto: Number(event.target.value) } })}
                      className="h-10 w-full rounded-sm border border-border bg-surface-container px-3 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="space-y-3 rounded-sm border border-border bg-surface-high p-3">
                  <h3 className="text-sm font-semibold text-foreground">필드 임계값</h3>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Positive</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.fieldThresholds.positive}
                      onChange={(event) => onPatchDraft({ fieldThresholds: { ...draft.fieldThresholds, positive: Number(event.target.value) } })}
                      className="h-10 w-full rounded-sm border border-border bg-surface-container px-3 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Negative</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.fieldThresholds.negative}
                      onChange={(event) => onPatchDraft({ fieldThresholds: { ...draft.fieldThresholds, negative: Number(event.target.value) } })}
                      className="h-10 w-full rounded-sm border border-border bg-surface-container px-3 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Auto</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.fieldThresholds.auto}
                      onChange={(event) => onPatchDraft({ fieldThresholds: { ...draft.fieldThresholds, auto: Number(event.target.value) } })}
                      className="h-10 w-full rounded-sm border border-border bg-surface-container px-3 text-sm text-foreground outline-none focus:border-primary"
                    />
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
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>텍스트 유사도 설정을 저장하지 못했어</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
