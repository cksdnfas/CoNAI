import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import type { GeneralSettings } from '@/types/settings'
import { SettingsField, SettingsInsetBlock, SettingsSection, SettingsToggleRow } from './settings-primitives'

interface GeneralTabProps {
  generalDraft: GeneralSettings | null
  onPatchGeneral: (patch: Partial<GeneralSettings>) => void
  onPatchDeleteProtection: (patch: Partial<GeneralSettings['deleteProtection']>) => void
  onSave: () => void
  isSaving: boolean
}

/** Render app-wide defaults that should be easy to find from the first settings tab. */
export function GeneralTab({ generalDraft, onPatchGeneral, onPatchDeleteProtection, onSave, isSaving }: GeneralTabProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-6">
      <section>
        <SettingsSection
          heading={t({ ko: '일반 설정', en: 'General settings' })}
          actions={(
            <Button
              size="icon-sm"
              onClick={onSave}
              disabled={!generalDraft || isSaving}
              aria-label={t({ ko: '일반 설정 저장', en: 'Save general settings' })}
              title={t({ ko: '일반 설정 저장', en: 'Save general settings' })}
            >
              <Save className="h-4 w-4" />
            </Button>
          )}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {generalDraft ? (
              <>
                <SettingsInsetBlock className="text-sm text-muted-foreground md:col-span-2">
                  {t({
                    ko: '기본 동작과 삭제 보호를 여기서 먼저 조절해. RecycleBin은 user 폴더 기준 경로를 사용해.',
                    en: 'Adjust default behavior and delete protection here first. RecycleBin uses a path relative to the user folder.',
                  })}
                </SettingsInsetBlock>

                <SettingsField label={t({ ko: '언어', en: 'Language' })}>
                  <Select
                    variant="settings"
                    value={generalDraft.language}
                    onChange={(event) => onPatchGeneral({ language: event.target.value as GeneralSettings['language'] })}
                  >
                    <option value="ko">{t({ ko: '한국어', en: 'Korean' })}</option>
                    <option value="en">{t({ ko: '영어', en: 'English' })}</option>
                  </Select>
                </SettingsField>

                <SettingsField label={t({ ko: 'RecycleBin 경로', en: 'RecycleBin path' })}>
                  <Input
                    variant="settings"
                    value={generalDraft.deleteProtection.recycleBinPath}
                    onChange={(event) => onPatchDeleteProtection({ recycleBinPath: event.target.value })}
                    placeholder="RecycleBin"
                  />
                </SettingsField>

                <SettingsField label={t({ ko: '유사/중복 검사', en: 'Similar/duplicate check' })}>
                  <Select
                    variant="settings"
                    value={generalDraft.imageSimilarityCheckMode ?? 'always'}
                    onChange={(event) => onPatchGeneral({ imageSimilarityCheckMode: event.target.value as GeneralSettings['imageSimilarityCheckMode'] })}
                  >
                    <option value="manual">{t({ ko: '수동 실행', en: 'Manual' })}</option>
                    <option value="always">{t({ ko: '상세 열 때 자동 실행', en: 'Auto on detail open' })}</option>
                  </Select>
                </SettingsField>

                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={generalDraft.deleteProtection.enabled}
                    onChange={(event) => onPatchDeleteProtection({ enabled: event.target.checked })}
                  />
                  {t({ ko: '삭제 시 RecycleBin 보호 사용', en: 'Use RecycleBin protection when deleting' })}
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={generalDraft.enableGallery ?? true}
                    onChange={(event) => onPatchGeneral({ enableGallery: event.target.checked })}
                  />
                  {t({ ko: '갤러리 기능 사용', en: 'Enable gallery features' })}
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={generalDraft.showRatingBadges ?? true}
                    onChange={(event) => onPatchGeneral({ showRatingBadges: event.target.checked })}
                  />
                  {t({ ko: '등급 배지 표시', en: 'Show rating badges' })}
                </SettingsToggleRow>

                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={generalDraft.autoCleanupCanvasOnShutdown ?? false}
                    onChange={(event) => onPatchGeneral({ autoCleanupCanvasOnShutdown: event.target.checked })}
                  />
                  {t({ ko: '종료 시 캔버스 임시 데이터를 자동 정리', en: 'Automatically clean up temporary canvas data on exit' })}
                </SettingsToggleRow>
              </>
            ) : (
              <Skeleton className="h-56 w-full rounded-sm md:col-span-2" />
            )}
          </div>
        </SettingsSection>
      </section>
    </div>
  )
}
