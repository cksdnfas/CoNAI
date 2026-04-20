import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingsField, SettingsInsetBlock, SettingsSection, SettingsToggleRow } from './settings-primitives'
import type { VideoOptimizationSettings } from '@/types/settings'

const VIDEO_PRESETS: Array<{ value: VideoOptimizationSettings['preset']; label: string; crf: number; audioBitrateKbps: number }> = [
  { value: 'high-quality', label: '고화질', crf: 22, audioBitrateKbps: 192 },
  { value: 'balanced', label: '균형', crf: 26, audioBitrateKbps: 128 },
  { value: 'economy', label: '절약', crf: 30, audioBitrateKbps: 96 },
]

interface VideoOptimizationTabProps {
  videoOptimizationDraft: VideoOptimizationSettings | null
  onPatchVideoOptimization: (patch: Partial<VideoOptimizationSettings>) => void
  onSave: () => void
  isSaving: boolean
}

/** Render H.264 MP4 optimization defaults for upload, generated-output, and backup video flows. */
export function VideoOptimizationTab({
  videoOptimizationDraft,
  onPatchVideoOptimization,
  onSave,
  isSaving,
}: VideoOptimizationTabProps) {
  return (
    <div className="space-y-6">
      <section>
        <SettingsSection
          heading="비디오 최적화"
          actions={
            <Button
              size="icon-sm"
              onClick={onSave}
              disabled={!videoOptimizationDraft || isSaving}
              aria-label="비디오 최적화 설정 저장"
              title="비디오 최적화 설정 저장"
            >
              <Save className="h-4 w-4" />
            </Button>
          }
        >
          {videoOptimizationDraft ? (
            <div className="space-y-4">
              <SettingsInsetBlock className="text-sm text-muted-foreground">
                H.264 MP4로 저장하고, 원본 크기는 유지해. 원본은 따로 남기지 않아.
              </SettingsInsetBlock>

              <div className="grid gap-4 md:grid-cols-2">
                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={videoOptimizationDraft.enabled}
                    onChange={(event) => onPatchVideoOptimization({ enabled: event.target.checked })}
                  />
                  비디오 최적화 사용
                </SettingsToggleRow>

                <SettingsField label="프리셋">
                  <Select
                    variant="settings"
                    value={videoOptimizationDraft.preset}
                    onChange={(event) => {
                      const nextPreset = VIDEO_PRESETS.find((preset) => preset.value === event.target.value)
                      if (!nextPreset) return
                      onPatchVideoOptimization({
                        preset: nextPreset.value,
                        crf: nextPreset.crf,
                        audioBitrateKbps: nextPreset.audioBitrateKbps,
                      })
                    }}
                  >
                    {VIDEO_PRESETS.map((preset) => (
                      <option key={preset.value} value={preset.value}>{preset.label}</option>
                    ))}
                  </Select>
                </SettingsField>

                <SettingsField label="오디오 bitrate (kbps)">
                  <Input
                    type="number"
                    min={32}
                    max={320}
                    variant="settings"
                    value={videoOptimizationDraft.audioBitrateKbps}
                    onChange={(event) => onPatchVideoOptimization({ audioBitrateKbps: Number(event.target.value) || 32 })}
                  />
                </SettingsField>

                <SettingsField label="CRF">
                  <Input
                    type="number"
                    min={18}
                    max={40}
                    variant="settings"
                    value={videoOptimizationDraft.crf}
                    onChange={(event) => onPatchVideoOptimization({ crf: Number(event.target.value) || 18 })}
                  />
                </SettingsField>

                <div className="md:col-span-2 grid gap-3">
                  <SettingsToggleRow>
                    <input
                      type="checkbox"
                      checked={videoOptimizationDraft.applyToUpload}
                      onChange={(event) => onPatchVideoOptimization({ applyToUpload: event.target.checked })}
                    />
                    업로드 비디오에 적용
                  </SettingsToggleRow>

                  <SettingsToggleRow>
                    <input
                      type="checkbox"
                      checked={videoOptimizationDraft.applyToGeneratedOutputs}
                      onChange={(event) => onPatchVideoOptimization({ applyToGeneratedOutputs: event.target.checked })}
                    />
                    생성 결과 비디오에 적용
                  </SettingsToggleRow>

                  <SettingsToggleRow>
                    <input
                      type="checkbox"
                      checked={videoOptimizationDraft.applyToBackupImports}
                      onChange={(event) => onPatchVideoOptimization({ applyToBackupImports: event.target.checked })}
                    />
                    백업 유입 비디오에 적용
                  </SettingsToggleRow>
                </div>
              </div>
            </div>
          ) : (
            <Skeleton className="h-56 w-full rounded-sm" />
          )}
        </SettingsSection>
      </section>
    </div>
  )
}
