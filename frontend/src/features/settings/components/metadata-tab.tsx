import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { RowGroup } from '@/components/ui/row-group'
import type { MetadataExtractionSettings } from '@conai/shared'
import { useI18n } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SectionDirtyBadge } from './settings-section-status'
import { SettingsSwitchRow } from './settings-switch-row'
import { SETTINGS_CONTROL_CLASS, SettingsRowsSkeleton } from './settings-rows'

interface MetadataTabProps {
  metadataDraft: MetadataExtractionSettings | null
  onPatchMetadata: (patch: Partial<MetadataExtractionSettings>) => void
  hasChanges: boolean
}

export function MetadataTab({ metadataDraft, onPatchMetadata, hasChanges }: MetadataTabProps) {
  const { t } = useI18n()
  const isStealthEnabled = metadataDraft?.enableSecondaryExtraction === true
  const scanModeLabel = t({ ko: '숨은 정보 탐색 방식', en: 'Hidden info scan' })
  const maxFileSizeLabel = t('metadataTab.maximumFileSizeMb')
  const maxResolutionLabel = t('metadataTab.maximumResolutionMp')

  return (
    <RowGroup heading={t({ ko: '메타데이터', en: 'Metadata' })} actions={<SectionDirtyBadge dirty={hasChanges} />}>
      {metadataDraft ? (
        <>
          <SettingsSwitchRow
            checked={metadataDraft.enableSecondaryExtraction}
            onCheckedChange={(checked) => onPatchMetadata({ enableSecondaryExtraction: checked })}
            label={t({ ko: 'PNG 숨은 생성 정보 찾기', en: 'Look for hidden generation info in PNGs' })}
          />

          <SettingRow label={scanModeLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Select variant="settings" aria-label={scanModeLabel} value={metadataDraft.stealthScanMode} disabled={!isStealthEnabled} onChange={(event) => onPatchMetadata({ stealthScanMode: event.target.value as MetadataExtractionSettings['stealthScanMode'] })}>
              <option value="fast">{t({ ko: '빠르게 (못 찾으면 전체 검사)', en: 'Fast (falls back to full)' })}</option>
              <option value="full">{t({ ko: '전체 검사 (느림)', en: 'Full (slower)' })}</option>
              <option value="skip">{t({ ko: '찾지 않음', en: 'Off' })}</option>
            </Select>
          </SettingRow>

          <SettingRow label={maxFileSizeLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput min={1} variant="settings" aria-label={maxFileSizeLabel} disabled={!isStealthEnabled} value={metadataDraft.stealthMaxFileSizeMB} onValueCommit={(nextValue) => onPatchMetadata({ stealthMaxFileSizeMB: Number(nextValue) || 1 })} />
          </SettingRow>

          <SettingRow label={maxResolutionLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput min={1} variant="settings" aria-label={maxResolutionLabel} disabled={!isStealthEnabled} value={metadataDraft.stealthMaxResolutionMP} onValueCommit={(nextValue) => onPatchMetadata({ stealthMaxResolutionMP: Number(nextValue) || 1 })} />
          </SettingRow>

          <SettingsSwitchRow
            checked={metadataDraft.skipStealthForComfyUI}
            disabled={!isStealthEnabled}
            onCheckedChange={(checked) => onPatchMetadata({ skipStealthForComfyUI: checked })}
            label={t({ ko: 'ComfyUI 이미지로 확인되면 숨은 정보 찾기 생략', en: 'Skip the hidden info scan for images identified as ComfyUI' })}
          />

          <SettingsSwitchRow
            checked={metadataDraft.skipStealthForWebUI}
            disabled={!isStealthEnabled}
            onCheckedChange={(checked) => onPatchMetadata({ skipStealthForWebUI: checked })}
            label={t({ ko: 'WebUI 이미지로 확인되면 숨은 정보 찾기 생략', en: 'Skip the hidden info scan for images identified as WebUI' })}
          />
        </>
      ) : (
        <SettingsRowsSkeleton rows={4} />
      )}
    </RowGroup>
  )
}
