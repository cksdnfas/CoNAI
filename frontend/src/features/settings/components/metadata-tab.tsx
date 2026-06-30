import { RefreshCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { MetadataExtractionSettings } from '@/types/settings'
import { SettingsField, SettingsInsetBlock, SettingsSection, SettingsToggleRow } from './settings-primitives'
import { useI18n } from '@/i18n'

interface MetadataTabProps {
  metadataDraft: MetadataExtractionSettings | null
  onPatchMetadata: (patch: Partial<MetadataExtractionSettings>) => void
  onSave: () => void
  isSaving: boolean
  hasChanges: boolean
  onReextractAll: () => void
  isReextracting: boolean
}

export function MetadataTab({ metadataDraft, onPatchMetadata, onSave, isSaving, hasChanges, onReextractAll, isReextracting }: MetadataTabProps) {
  const { t } = useI18n()
  const handleReextractAll = () => {
    if (!window.confirm(t('settings.metadataTab.reExtractAiMetadataFor'))) {
      return
    }
    onReextractAll()
  }

  return (
    <div className="space-y-6">
      <section>
        <SettingsSection
          heading={t({ ko: '메타데이터', en: 'Metadata' })}
          actions={
            <Button
              size="icon-sm"
              onClick={onSave}
              disabled={!metadataDraft || isSaving || !hasChanges}
              aria-label={hasChanges ? t('settings.metadataTab.metadataSave') : t({ ko: '메타데이터 설정 변경 없음', en: 'No metadata settings changes' })}
              title={hasChanges ? t('settings.metadataTab.metadataSave') : t({ ko: '저장할 변경 없음', en: 'No changes to save' })}
            >
              <Save className="h-4 w-4" />
            </Button>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            {metadataDraft ? (
              <>
                <SettingsInsetBlock className="flex flex-col gap-3 text-sm text-muted-foreground md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>{t('settings.metadataTab.standardMetadataIsReadFirst')}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleReextractAll}
                    disabled={isReextracting}
                  >
                    <RefreshCcw className={isReextracting ? 'animate-spin' : undefined} />
                    {isReextracting ? t({ ko: '등록 중...', en: 'Queuing...' }) : t({ ko: '모든 항목 재추출', en: 'Re-extract all items' })}
                  </Button>
                </SettingsInsetBlock>

                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={metadataDraft.enableSecondaryExtraction}
                    onChange={(event) => onPatchMetadata({ enableSecondaryExtraction: event.target.checked })}
                  />
                  {t({ ko: 'PNG secondary extraction 활성화', en: 'Enable PNG secondary extraction' })}
                </SettingsToggleRow>

                <SettingsField label={t({ ko: 'Stealth 스캔 모드', en: 'Stealth scan mode' })}>
                  <Select variant="settings" value={metadataDraft.stealthScanMode} onChange={(event) => onPatchMetadata({ stealthScanMode: event.target.value as MetadataExtractionSettings['stealthScanMode'] })}>
                    <option value="fast">{t({ ko: '빠르게', en: 'Fast' })}</option>
                    <option value="full">{t({ ko: '전체', en: 'Full' })}</option>
                    <option value="skip">{t({ ko: '건너뛰기', en: 'Skip' })}</option>
                  </Select>
                  <span className="mt-2 text-xs text-muted-foreground">{t({ ko: 'stealth 스캔 범위를 조절해.', en: 'Adjust the stealth scan range.' })}</span>
                </SettingsField>

                <SettingsField label={t('settings.metadataTab.maximumFileSizeMb')}>
                  <Input type="number" min={1} variant="settings" value={metadataDraft.stealthMaxFileSizeMB} onChange={(event) => onPatchMetadata({ stealthMaxFileSizeMB: Number(event.target.value) || 1 })} />
                </SettingsField>

                <SettingsField label={t('settings.metadataTab.maximumResolutionMp')}>
                  <Input type="number" min={1} variant="settings" value={metadataDraft.stealthMaxResolutionMP} onChange={(event) => onPatchMetadata({ stealthMaxResolutionMP: Number(event.target.value) || 1 })} />
                </SettingsField>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={metadataDraft.skipStealthForComfyUI}
                    onChange={(event) => onPatchMetadata({ skipStealthForComfyUI: event.target.checked })}
                  />
                  {t({ ko: 'ComfyUI로 이미 판단되면 PNG stealth fallback 스킵', en: 'Skip PNG stealth fallback if already identified as ComfyUI' })}
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={metadataDraft.skipStealthForWebUI}
                    onChange={(event) => onPatchMetadata({ skipStealthForWebUI: event.target.checked })}
                  />
                  {t({ ko: 'WebUI로 이미 판단되면 PNG stealth fallback 스킵', en: 'Skip PNG stealth fallback if already identified as WebUI' })}
                </SettingsToggleRow>
              </>
            ) : (
              <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
            )}
          </div>
        </SettingsSection>
      </section>
    </div>
  )
}
