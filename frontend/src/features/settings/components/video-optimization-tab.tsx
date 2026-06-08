import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n, type TranslationDictionary } from '@/i18n'
import { SettingsField, SettingsInsetBlock, SettingsSection, SettingsToggleRow } from './settings-primitives'
import type { VideoOptimizationSettings } from '@/types/settings'

const VIDEO_PRESETS: Array<{ value: VideoOptimizationSettings['preset']; label: TranslationDictionary; crf: number; audioBitrateKbps: number }> = [
  { value: 'high-quality', label: { ko: '고화질', en: 'High quality' }, crf: 22, audioBitrateKbps: 192 },
  { value: 'balanced', label: { ko: '균형', en: 'Balanced' }, crf: 26, audioBitrateKbps: 128 },
  { value: 'economy', label: { ko: '절약', en: 'Economy' }, crf: 30, audioBitrateKbps: 96 },
]

interface VideoOptimizationTabProps {
  videoOptimizationDraft: VideoOptimizationSettings | null
  onPatchVideoOptimization: (patch: Partial<VideoOptimizationSettings>) => void
  onSave: () => void
  isSaving: boolean
  hasChanges: boolean
}

/** Render H.264 MP4 optimization defaults for upload, generated-output, and backup video flows. */
export function VideoOptimizationTab({
  videoOptimizationDraft,
  onPatchVideoOptimization,
  onSave,
  isSaving,
  hasChanges,
}: VideoOptimizationTabProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-6">
      <section>
        <SettingsSection
          heading={t({ ko: '비디오 최적화', en: 'Video optimization' })}
          actions={
            <Button
              size="icon-sm"
              onClick={onSave}
              disabled={!videoOptimizationDraft || isSaving || !hasChanges}
              aria-label={hasChanges ? t({ ko: '비디오 최적화 설정 저장', en: 'Save video optimization settings' }) : t({ ko: '비디오 최적화 설정 변경 없음', en: 'No video optimization settings changes' })}
              title={hasChanges ? t({ ko: '비디오 최적화 설정 저장', en: 'Save video optimization settings' }) : t({ ko: '저장할 변경 없음', en: 'No changes to save' })}
            >
              <Save className="h-4 w-4" />
            </Button>
          }
        >
          {videoOptimizationDraft ? (
            <div className="space-y-4">
              <SettingsInsetBlock className="text-sm text-muted-foreground">
                {t({ ko: 'H.264 MP4로 저장하고, 원본 크기는 유지해. 원본은 따로 남기지 않아.', en: 'Save as H.264 MP4, keep the original dimensions, and do not keep a separate original copy.' })}
              </SettingsInsetBlock>

              <div className="grid gap-4 md:grid-cols-2">
                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={videoOptimizationDraft.enabled}
                    onChange={(event) => onPatchVideoOptimization({ enabled: event.target.checked })}
                  />
                  {t({ ko: '비디오 최적화 사용', en: 'Enable video optimization' })}
                </SettingsToggleRow>

                <SettingsField label={t({ ko: '프리셋', en: 'Preset' })}>
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
                      <option key={preset.value} value={preset.value}>{t(preset.label)}</option>
                    ))}
                  </Select>
                </SettingsField>

                <SettingsField label={t({ ko: '오디오 bitrate (kbps)', en: 'Audio bitrate (kbps)' })}>
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
                    {t({ ko: '업로드 비디오에 적용', en: 'Apply to uploaded videos' })}
                  </SettingsToggleRow>

                  <SettingsToggleRow>
                    <input
                      type="checkbox"
                      checked={videoOptimizationDraft.applyToGeneratedOutputs}
                      onChange={(event) => onPatchVideoOptimization({ applyToGeneratedOutputs: event.target.checked })}
                    />
                    {t({ ko: '생성 결과 비디오에 적용', en: 'Apply to generated output videos' })}
                  </SettingsToggleRow>

                  <SettingsToggleRow>
                    <input
                      type="checkbox"
                      checked={videoOptimizationDraft.applyToBackupImports}
                      onChange={(event) => onPatchVideoOptimization({ applyToBackupImports: event.target.checked })}
                    />
                    {t({ ko: '백업 유입 비디오에 적용', en: 'Apply to backup-imported videos' })}
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
