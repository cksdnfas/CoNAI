import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import type { GeneralSettings, HeaderNavigationItemKey } from '@conai/shared'
import { DEFAULT_HEADER_NAVIGATION_SETTINGS } from '@/lib/settings-defaults'
import { SettingsField, SettingsInsetBlock, SettingsSection, SettingsToggleRow } from './settings-primitives'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

export type GeneralPreferenceSection = 'basic' | 'appearance' | 'library' | 'safety'

interface GeneralPreferencesSectionsProps {
  sections: GeneralPreferenceSection[]
  generalDraft: GeneralSettings | null
  onPatchGeneral: (patch: Partial<GeneralSettings>) => void
  onPatchDeleteProtection: (patch: Partial<GeneralSettings['deleteProtection']>) => void
  onSave: () => void
  isSaving: boolean
  hasChanges: boolean
}

const HEADER_NAVIGATION_OPTIONS: Array<{ key: HeaderNavigationItemKey; label: { ko: string; en: string } }> = [
  { key: 'access', label: { ko: '페이지 목록', en: 'Page list' } },
  { key: 'home', label: { ko: '홈', en: 'Home' } },
  { key: 'groups', label: { ko: '그룹', en: 'Groups' } },
  { key: 'prompts', label: { ko: '프롬프트', en: 'Prompts' } },
  { key: 'generation', label: { ko: '생성', en: 'Generation' } },
  { key: 'upload', label: { ko: '업로드', en: 'Upload' } },
  { key: 'wallpaper', label: { ko: '월페이퍼', en: 'Wallpaper' } },
  { key: 'settings', label: { ko: '설정', en: 'Settings' } },
  { key: 'search', label: { ko: '검색', en: 'Search' } },
  { key: 'queue', label: { ko: '대기열', en: 'Queue' } },
  { key: 'account', label: { ko: '사용자', en: 'User' } },
]

/** Render app-wide preferences in their user-facing settings category. */
export function GeneralPreferencesSections({
  sections,
  generalDraft,
  onPatchGeneral,
  onPatchDeleteProtection,
  onSave,
  isSaving,
  hasChanges,
}: GeneralPreferencesSectionsProps) {
  const { t } = useI18n()
  const visibleSections = new Set(sections)

  const saveAction = (
    <Button
      size="icon-sm"
      onClick={onSave}
      disabled={!generalDraft || isSaving || !hasChanges}
      aria-label={hasChanges ? t({ ko: '설정 저장', en: 'Save settings' }) : t({ ko: '설정 변경 없음', en: 'No settings changes' })}
      title={hasChanges ? t({ ko: '설정 저장', en: 'Save settings' }) : t({ ko: '저장할 변경 없음', en: 'No changes to save' })}
    >
      <Save className="h-4 w-4" />
    </Button>
  )

  const updateHeaderNavigationItem = (key: HeaderNavigationItemKey, checked: boolean) => {
    if (!generalDraft) return
    onPatchGeneral({
      headerNavigation: {
        ...DEFAULT_HEADER_NAVIGATION_SETTINGS,
        ...generalDraft.headerNavigation,
        [key]: checked,
      },
    })
  }

  if (!generalDraft) {
    return <Skeleton className="h-56 w-full rounded-sm" />
  }

  return (
    <div className="space-y-6">
      {visibleSections.has('basic') ? (
        <SettingsSection heading={t({ ko: '기본 설정', en: 'General' })} actions={saveAction}>
          <div className="grid gap-4 md:grid-cols-2">
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
            <SettingsToggleRow>
              <input
                type="checkbox"
                checked={generalDraft.promptForDownloadLocation ?? false}
                onChange={(event) => onPatchGeneral({ promptForDownloadLocation: event.target.checked })}
              />
              {t({ ko: '다운로드할 때 파일명과 저장 위치 확인', en: 'Ask for file name and save location' })}
            </SettingsToggleRow>
          </div>
        </SettingsSection>
      ) : null}

      {visibleSections.has('appearance') ? (
        <SettingsSection heading={t({ ko: '탐색 및 표시', en: 'Navigation and display' })} actions={saveAction}>
          <div className="grid gap-4 md:grid-cols-2">
            <SettingsToggleRow>
              <input type="checkbox" checked={generalDraft.enableGallery ?? true} onChange={(event) => onPatchGeneral({ enableGallery: event.target.checked })} />
              {t({ ko: '갤러리 기능 사용', en: 'Enable gallery features' })}
            </SettingsToggleRow>
            <SettingsToggleRow>
              <input type="checkbox" checked={generalDraft.showRatingBadges ?? true} onChange={(event) => onPatchGeneral({ showRatingBadges: event.target.checked })} />
              {t({ ko: '등급 배지 표시', en: 'Show rating badges' })}
            </SettingsToggleRow>
            <SettingsInsetBlock className="md:col-span-2">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t({ ko: '상단 네비 표시', en: 'Header navigation' })}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {HEADER_NAVIGATION_OPTIONS.map((option) => (
                  <SettingsToggleRow key={option.key}>
                    <input
                      type="checkbox"
                      checked={(generalDraft.headerNavigation ?? DEFAULT_HEADER_NAVIGATION_SETTINGS)[option.key] ?? true}
                      onChange={(event) => updateHeaderNavigationItem(option.key, event.target.checked)}
                    />
                    {t(option.label)}
                  </SettingsToggleRow>
                ))}
              </div>
            </SettingsInsetBlock>
          </div>
        </SettingsSection>
      ) : null}

      {visibleSections.has('library') ? (
        <SettingsSection heading={t({ ko: '라이브러리 동작', en: 'Library behavior' })} actions={saveAction}>
          <div className="grid gap-4 md:grid-cols-2">
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
          </div>
        </SettingsSection>
      ) : null}

      {visibleSections.has('safety') ? (
        <SettingsSection heading={t({ ko: '안전 및 정리', en: 'Safety and cleanup' })} actions={saveAction}>
          <div className="grid gap-4 md:grid-cols-2">
            <SettingsField label={t({ ko: '휴지통 경로', en: 'Recycle bin path' })}>
              <Input
                variant="settings"
                value={generalDraft.deleteProtection.recycleBinPath}
                onChange={(event) => onPatchDeleteProtection({ recycleBinPath: event.target.value })}
                placeholder="RecycleBin"
              />
            </SettingsField>
            <SettingsField label={t({ ko: '생성 히스토리 최대 항목 수', en: 'Generation history maximum items' })}>
              <NumberStepperInput
                variant="settings"

                min={1}
                max={1_000_000}
                step={1}
                value={generalDraft.generationHistoryMaxItems ?? 10_000}
                onValueCommit={(nextValue) => {
                  const parsedValue = Number.parseInt(nextValue, 10)
                  if (Number.isFinite(parsedValue)) {
                    onPatchGeneral({ generationHistoryMaxItems: parsedValue })
                  }
                }}
              />
            </SettingsField>
            <SettingsToggleRow className="md:col-span-2">
              <input type="checkbox" checked={generalDraft.deleteProtection.enabled} onChange={(event) => onPatchDeleteProtection({ enabled: event.target.checked })} />
              {t({ ko: '삭제할 때 휴지통으로 보호', en: 'Protect deleted files with the recycle bin' })}
            </SettingsToggleRow>
            <SettingsToggleRow className="md:col-span-2">
              <input type="checkbox" checked={generalDraft.autoCleanupCanvasOnShutdown ?? false} onChange={(event) => onPatchGeneral({ autoCleanupCanvasOnShutdown: event.target.checked })} />
              {t({ ko: '종료 시 캔버스 임시 데이터 자동 정리', en: 'Clean up temporary canvas data on exit' })}
            </SettingsToggleRow>
            <SettingsToggleRow className="md:col-span-2">
              <input
                type="checkbox"
                checked={generalDraft.applyRatingSafetyToGenerationHistory ?? false}
                onChange={(event) => onPatchGeneral({ applyRatingSafetyToGenerationHistory: event.target.checked })}
              />
              {t({ ko: '생성 히스토리에도 등급 표시 규칙 적용', en: 'Apply rating visibility rules to generation history' })}
            </SettingsToggleRow>
          </div>
        </SettingsSection>
      ) : null}
    </div>
  )
}
