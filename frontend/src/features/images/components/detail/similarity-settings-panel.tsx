import { Settings2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { SimilaritySettings } from '@/types/settings'
import type { SimilaritySettingsDraft } from './image-detail-utils'

interface SimilaritySettingsPanelProps {
  isOpen: boolean
  draft: SimilaritySettingsDraft | null
  isSaving: boolean
  errorMessage: string | null
  onToggle: () => void
  onPatchDraft: (patch: Partial<SimilaritySettingsDraft>) => void
  onApply: () => void
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
      <div className="relative">
        <Button size="sm" variant="outline" onClick={onToggle}>
          <Settings2 className="h-4 w-4" />
          유사도 설정
        </Button>

        {isOpen && draft ? (
          <div className="absolute right-0 top-12 z-30 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface-container p-4 shadow-[0_0_32px_rgba(14,14,14,0.28)]">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Threshold</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={64}
                    step={1}
                    value={draft.detailSimilarThreshold}
                    onChange={(event) => onPatchDraft({ detailSimilarThreshold: Number(event.target.value) })}
                    className="w-full"
                  />
                  <span className="w-10 text-right text-sm text-foreground">{draft.detailSimilarThreshold}</span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Limit</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.detailSimilarLimit}
                    onChange={(event) => onPatchDraft({ detailSimilarLimit: Number(event.target.value) })}
                    className="h-10 w-full rounded-sm border border-border bg-surface-high px-3 text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Sort By</label>
                  <select
                    value={draft.detailSimilarSortBy}
                    onChange={(event) => onPatchDraft({ detailSimilarSortBy: event.target.value as SimilaritySettings['detailSimilarSortBy'] })}
                    className="h-10 w-full rounded-sm border border-border bg-surface-high px-3 text-sm text-foreground outline-none focus:border-primary"
                  >
                    <option value="similarity">Similarity</option>
                    <option value="upload_date">Upload date</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Sort Order</label>
                  <select
                    value={draft.detailSimilarSortOrder}
                    onChange={(event) => onPatchDraft({ detailSimilarSortOrder: event.target.value as SimilaritySettings['detailSimilarSortOrder'] })}
                    className="h-10 w-full rounded-sm border border-border bg-surface-high px-3 text-sm text-foreground outline-none focus:border-primary"
                  >
                    <option value="DESC">DESC</option>
                    <option value="ASC">ASC</option>
                  </select>
                </div>

                <label className="flex items-center gap-3 rounded-sm border border-border bg-surface-high px-3 py-2.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={draft.detailSimilarIncludeColorSimilarity}
                    onChange={(event) => onPatchDraft({ detailSimilarIncludeColorSimilarity: event.target.checked })}
                    className="h-4 w-4"
                  />
                  색상 유사도 포함
                </label>
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
          <AlertTitle>유사 이미지 설정을 저장하지 못했어</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
