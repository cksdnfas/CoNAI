import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { MetadataExtractionSettings } from '@conai/shared'
import { Field } from '@/components/ui/field'
import { Section } from '@/components/ui/section'
import { useI18n } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SectionDirtyBadge } from './settings-section-status'
import { SettingsSwitchRow } from './settings-switch-row'

interface MetadataTabProps {
  metadataDraft: MetadataExtractionSettings | null
  onPatchMetadata: (patch: Partial<MetadataExtractionSettings>) => void
  hasChanges: boolean
}

export function MetadataTab({ metadataDraft, onPatchMetadata, hasChanges }: MetadataTabProps) {
  const { t } = useI18n()
  const isStealthEnabled = metadataDraft?.enableSecondaryExtraction === true

  return (
    <div className="space-y-6">
      <section>
        <Section
          variant="settings"
          heading={t({ ko: '메타데이터', en: 'Metadata' })}
          actions={<SectionDirtyBadge dirty={hasChanges} />}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {metadataDraft ? (
              <>
                <SettingsSwitchRow
                  checked={metadataDraft.enableSecondaryExtraction}
                  onCheckedChange={(checked) => onPatchMetadata({ enableSecondaryExtraction: checked })}
                  label={t({ ko: 'PNG 숨은 생성 정보 찾기', en: 'Look for hidden generation info in PNGs' })}
                  className="md:col-span-2"
                />

                <Field label={t({ ko: '숨은 정보 탐색 방식', en: 'Hidden info scan' })}>
                  <Select variant="settings" value={metadataDraft.stealthScanMode} disabled={!isStealthEnabled} onChange={(event) => onPatchMetadata({ stealthScanMode: event.target.value as MetadataExtractionSettings['stealthScanMode'] })}>
                    <option value="fast">{t({ ko: '빠르게 (못 찾으면 전체 검사)', en: 'Fast (falls back to full)' })}</option>
                    <option value="full">{t({ ko: '전체 검사 (느림)', en: 'Full (slower)' })}</option>
                    <option value="skip">{t({ ko: '찾지 않음', en: 'Off' })}</option>
                  </Select>
                </Field>

                <Field label={t('metadataTab.maximumFileSizeMb')}>
                  <NumberStepperInput min={1} variant="settings" disabled={!isStealthEnabled} value={metadataDraft.stealthMaxFileSizeMB} onValueCommit={(nextValue) => onPatchMetadata({ stealthMaxFileSizeMB: Number(nextValue) || 1 })} />
                </Field>

                <Field label={t('metadataTab.maximumResolutionMp')}>
                  <NumberStepperInput min={1} variant="settings" disabled={!isStealthEnabled} value={metadataDraft.stealthMaxResolutionMP} onValueCommit={(nextValue) => onPatchMetadata({ stealthMaxResolutionMP: Number(nextValue) || 1 })} />
                </Field>

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
              <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
            )}
          </div>
        </Section>
      </section>
    </div>
  )
}
