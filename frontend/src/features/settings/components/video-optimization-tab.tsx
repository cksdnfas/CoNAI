import { Select } from '@/components/ui/select'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { useI18n, type TranslationDictionary } from '@/i18n'
import type { VideoOptimizationSettings } from '@conai/shared'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SectionDirtyBadge } from './settings-section-status'
import { SettingsSwitchRow } from './settings-switch-row'
import { SettingsLabelTip } from './settings-label-tip'
import { SETTINGS_CONTROL_CLASS, SettingsRowsSkeleton } from './settings-rows'

/** Select value shown when CRF/audio no longer match any preset; never sent to the server. */
const CUSTOM_PRESET_VALUE = 'custom'

const VIDEO_PRESETS: Array<{ value: VideoOptimizationSettings['preset']; label: TranslationDictionary; crf: number; audioBitrateKbps: number }> = [
  { value: 'high-quality', label: { ko: '고화질', en: 'High quality' }, crf: 22, audioBitrateKbps: 192 },
  { value: 'balanced', label: { ko: '균형', en: 'Balanced' }, crf: 26, audioBitrateKbps: 128 },
  { value: 'economy', label: { ko: '절약', en: 'Economy' }, crf: 30, audioBitrateKbps: 96 },
]

interface VideoOptimizationTabProps {
  videoOptimizationDraft: VideoOptimizationSettings | null
  onPatchVideoOptimization: (patch: Partial<VideoOptimizationSettings>) => void
  hasChanges: boolean
}

/** Render H.264 MP4 optimization defaults for upload, generated-output, and backup video flows. */
export function VideoOptimizationTab({
  videoOptimizationDraft,
  onPatchVideoOptimization,
  hasChanges,
}: VideoOptimizationTabProps) {
  const { t } = useI18n()
  const isEnabled = videoOptimizationDraft?.enabled === true
  // Editing CRF/audio by hand leaves the named preset behind, so show "Custom" instead of a stale name.
  const matchedPreset = videoOptimizationDraft
    ? VIDEO_PRESETS.find((preset) => preset.crf === videoOptimizationDraft.crf && preset.audioBitrateKbps === videoOptimizationDraft.audioBitrateKbps)
    : undefined

  const presetLabel = t({ ko: '프리셋', en: 'Preset' })
  const audioLabel = t({ ko: '오디오 비트레이트(kbps)', en: 'Audio bitrate (kbps)' })
  const crfLabel = t({ ko: '화질 (CRF)', en: 'Quality (CRF)' })

  return (
    <RowGroup
      heading={<SettingsLabelTip label={t({ ko: '비디오 최적화', en: 'Video optimization' })} tip={t({ ko: 'H.264 MP4로 저장하고, 원본 크기는 유지해. 원본은 따로 남기지 않아.', en: 'Save as H.264 MP4, keep the original dimensions, and do not keep a separate original copy.' })} />}
      actions={<SectionDirtyBadge dirty={hasChanges} />}
    >
      {videoOptimizationDraft ? (
        <>
          <SettingsSwitchRow
            checked={videoOptimizationDraft.enabled}
            onCheckedChange={(checked) => onPatchVideoOptimization({ enabled: checked })}
            label={t({ ko: '비디오 최적화 사용', en: 'Enable video optimization' })}
          />

          <SettingRow label={presetLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Select
              variant="settings"
              aria-label={presetLabel}
              value={matchedPreset?.value ?? CUSTOM_PRESET_VALUE}
              disabled={!isEnabled}
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
              {matchedPreset ? null : <option value={CUSTOM_PRESET_VALUE} disabled>{t({ ko: '사용자 지정', en: 'Custom' })}</option>}
            </Select>
          </SettingRow>

          <SettingRow label={audioLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput
              disabled={!isEnabled}
              min={32}
              max={320}
              variant="settings"
              aria-label={audioLabel}
              value={videoOptimizationDraft.audioBitrateKbps}
              onValueCommit={(nextValue) => onPatchVideoOptimization({ audioBitrateKbps: Number(nextValue) || 32 })}
            />
          </SettingRow>

          <SettingRow label={crfLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput
              disabled={!isEnabled}
              min={18}
              max={40}
              variant="settings"
              aria-label={crfLabel}
              value={videoOptimizationDraft.crf}
              onValueCommit={(nextValue) => onPatchVideoOptimization({ crf: Number(nextValue) || 18 })}
            />
          </SettingRow>

          <SettingsSwitchRow
            checked={videoOptimizationDraft.applyToUpload}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatchVideoOptimization({ applyToUpload: checked })}
            label={t({ ko: '업로드 비디오에 적용', en: 'Apply to uploaded videos' })}
          />
          <SettingsSwitchRow
            checked={videoOptimizationDraft.applyToGeneratedOutputs}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatchVideoOptimization({ applyToGeneratedOutputs: checked })}
            label={t({ ko: '생성 결과 비디오에 적용', en: 'Apply to generated output videos' })}
          />
          <SettingsSwitchRow
            checked={videoOptimizationDraft.applyToBackupImports}
            disabled={!isEnabled}
            onCheckedChange={(checked) => onPatchVideoOptimization({ applyToBackupImports: checked })}
            label={t({ ko: '백업 유입 비디오에 적용', en: 'Apply to backup-imported videos' })}
          />
        </>
      ) : (
        <SettingsRowsSkeleton rows={4} />
      )}
    </RowGroup>
  )
}
