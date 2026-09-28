import { RefreshCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { MetadataExtractionSettings } from '@conai/shared'
import { Field } from '@/components/ui/field'
import { Inset } from '@/components/ui/inset'
import { ToggleRow } from '@/components/ui/toggle-row'
import { Section } from '@/components/ui/section'
import { useI18n } from '@/i18n'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

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
  const isStealthEnabled = metadataDraft?.enableSecondaryExtraction === true
  const handleReextractAll = () => {
    if (!window.confirm(t('metadataTab.reExtractAiMetadataFor'))) {
      return
    }
    onReextractAll()
  }

  return (
    <div className="space-y-6">
      <section>
        <Section
          variant="settings"
          heading={t({ ko: '메타데이터', en: 'Metadata' })}
          actions={
            <Button
              size="icon-sm"
              onClick={onSave}
              disabled={!metadataDraft || isSaving || !hasChanges}
              aria-label={hasChanges ? t('metadataTab.metadataSave') : t({ ko: '메타데이터 설정 변경 없음', en: 'No metadata settings changes' })}
              title={hasChanges ? t('metadataTab.metadataSave') : t({ ko: '저장할 변경 없음', en: 'No changes to save' })}
            >
              <Save className="h-4 w-4" />
            </Button>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            {metadataDraft ? (
              <>
                <Inset className="flex flex-col gap-3 text-sm text-muted-foreground md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>{t('metadataTab.standardMetadataIsReadFirst')}</span>
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
                </Inset>

                <ToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={metadataDraft.enableSecondaryExtraction}
                    onChange={(event) => onPatchMetadata({ enableSecondaryExtraction: event.target.checked })}
                  />
                  {t({ ko: 'PNG 숨은 생성 정보 찾기', en: 'Look for hidden generation info in PNGs' })}
                </ToggleRow>

                <Field label={t({ ko: '숨은 정보 탐색 방식', en: 'Hidden info scan' })}>
                  <Select variant="settings" value={metadataDraft.stealthScanMode} disabled={!isStealthEnabled} onChange={(event) => onPatchMetadata({ stealthScanMode: event.target.value as MetadataExtractionSettings['stealthScanMode'] })}>
                    <option value="fast">{t({ ko: '빠르게 (못 찾으면 전체 검사)', en: 'Fast (falls back to full)' })}</option>
                    <option value="full">{t({ ko: '전체 검사 (느림)', en: 'Full (slower)' })}</option>
                    <option value="skip">{t({ ko: '찾지 않음', en: 'Off' })}</option>
                  </Select>
                  <span className="mt-2 text-xs text-muted-foreground">{t({ ko: '일부 생성기는 프롬프트를 픽셀 안에 숨겨 저장해. 빠르게는 앞부분만 먼저 확인해.', en: 'Some generators hide the prompt inside the pixels. Fast checks the start of the image first.' })}</span>
                </Field>

                <Field label={t('metadataTab.maximumFileSizeMb')} hint={t({ ko: '넘으면 건너뜀', en: 'Larger files are skipped' })}>
                  <NumberStepperInput min={1} variant="settings" disabled={!isStealthEnabled} value={metadataDraft.stealthMaxFileSizeMB} onValueCommit={(nextValue) => onPatchMetadata({ stealthMaxFileSizeMB: Number(nextValue) || 1 })} />
                </Field>

                <Field label={t('metadataTab.maximumResolutionMp')} hint={t({ ko: '넘으면 건너뜀', en: 'Larger images are skipped' })}>
                  <NumberStepperInput min={1} variant="settings" disabled={!isStealthEnabled} value={metadataDraft.stealthMaxResolutionMP} onValueCommit={(nextValue) => onPatchMetadata({ stealthMaxResolutionMP: Number(nextValue) || 1 })} />
                </Field>

                <ToggleRow>
                  <input
                    type="checkbox"
                    checked={metadataDraft.skipStealthForComfyUI}
                    disabled={!isStealthEnabled}
                    onChange={(event) => onPatchMetadata({ skipStealthForComfyUI: event.target.checked })}
                  />
                  {t({ ko: 'ComfyUI 이미지로 확인되면 숨은 정보 찾기 생략', en: 'Skip the hidden info scan for images identified as ComfyUI' })}
                </ToggleRow>

                <ToggleRow>
                  <input
                    type="checkbox"
                    checked={metadataDraft.skipStealthForWebUI}
                    disabled={!isStealthEnabled}
                    onChange={(event) => onPatchMetadata({ skipStealthForWebUI: event.target.checked })}
                  />
                  {t({ ko: 'WebUI 이미지로 확인되면 숨은 정보 찾기 생략', en: 'Skip the hidden info scan for images identified as WebUI' })}
                </ToggleRow>
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
