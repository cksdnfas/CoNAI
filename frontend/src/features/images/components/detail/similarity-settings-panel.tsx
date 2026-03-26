import { Settings2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ToggleRow } from '@/components/ui/toggle-row'
import type { SimilaritySettings } from '@/types/settings'
import type { SimilaritySettingsDraft } from './image-detail-utils'
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
        panelWidthClassName="w-[min(26rem,calc(100vw-2rem))]"
        icon={<Settings2 className="h-4 w-4" />}
      >
        {draft ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className={detailSettingsLabelClassName}>Threshold</label>
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
                <label className={detailSettingsLabelClassName}>Limit</label>
                <Input type="number" min={1} max={100} variant="detail" value={draft.detailSimilarLimit} onChange={(event) => onPatchDraft({ detailSimilarLimit: Number(event.target.value) })} />
              </div>

              <div className="space-y-2">
                <label className={detailSettingsLabelClassName}>Sort By</label>
                <Select variant="detail" value={draft.detailSimilarSortBy} onChange={(event) => onPatchDraft({ detailSimilarSortBy: event.target.value as SimilaritySettings['detailSimilarSortBy'] })}>
                  <option value="similarity">Similarity</option>
                  <option value="upload_date">Upload date</option>
                </Select>
              </div>

              <div className="space-y-2">
                <label className={detailSettingsLabelClassName}>Sort Order</label>
                <Select variant="detail" value={draft.detailSimilarSortOrder} onChange={(event) => onPatchDraft({ detailSimilarSortOrder: event.target.value as SimilaritySettings['detailSimilarSortOrder'] })}>
                  <option value="DESC">DESC</option>
                  <option value="ASC">ASC</option>
                </Select>
              </div>

              <ToggleRow variant="detail">
                <input
                  type="checkbox"
                  checked={draft.detailSimilarIncludeColorSimilarity}
                  onChange={(event) => onPatchDraft({ detailSimilarIncludeColorSimilarity: event.target.checked })}
                  className="h-4 w-4"
                />
                색상 유사도 포함
              </ToggleRow>
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
