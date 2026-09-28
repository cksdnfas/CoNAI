import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import type { GeneralSettings, HeaderNavigationItemKey } from '@conai/shared'
import { DEFAULT_HEADER_NAVIGATION_SETTINGS } from '@/lib/settings-defaults'
import { Field } from '@/components/ui/field'
import { Inset } from '@/components/ui/inset'
import { ToggleRow } from '@/components/ui/toggle-row'
import { Section } from '@/components/ui/section'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SectionDirtyBadge } from './settings-section-status'

export type GeneralPreferenceSection = 'basic' | 'appearance' | 'library' | 'safety'

interface GeneralPreferencesSectionsProps {
  sections: GeneralPreferenceSection[]
  generalDraft: GeneralSettings | null
  onPatchGeneral: (patch: Partial<GeneralSettings>) => void
  onPatchDeleteProtection: (patch: Partial<GeneralSettings['deleteProtection']>) => void
  /** Whether a section has edits waiting in the page save bar. */
  isSectionDirty: (section: GeneralPreferenceSection) => boolean
}

const HEADER_NAVIGATION_OPTIONS: Array<{ key: HeaderNavigationItemKey; label: { ko: string; en: string } }> = [
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
  isSectionDirty,
}: GeneralPreferencesSectionsProps) {
  const { t, languageOverride } = useI18n()
  const visibleSections = new Set(sections)

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
        <Section variant="settings" heading={t({ ko: '기본 설정', en: 'General' })} actions={<SectionDirtyBadge dirty={isSectionDirty('basic')} />}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t({ ko: '언어', en: 'Language' })}
              hint={languageOverride ? t({ ko: '이 브라우저는 계정 메뉴의 언어 선택이 우선', en: 'This browser uses its account-menu choice' }) : undefined}
            >
              <Select
                variant="settings"
                value={generalDraft.language}
                onChange={(event) => onPatchGeneral({ language: event.target.value as GeneralSettings['language'] })}
              >
                <option value="ko">{t({ ko: '한국어', en: 'Korean' })}</option>
                <option value="en">{t({ ko: '영어', en: 'English' })}</option>
              </Select>
            </Field>
            <ToggleRow>
              <input
                type="checkbox"
                checked={generalDraft.promptForDownloadLocation ?? false}
                onChange={(event) => onPatchGeneral({ promptForDownloadLocation: event.target.checked })}
              />
              {t({ ko: '다운로드할 때 파일명과 저장 위치 확인', en: 'Ask for file name and save location' })}
            </ToggleRow>
          </div>
        </Section>
      ) : null}

      {visibleSections.has('appearance') ? (
        <Section variant="settings" heading={t({ ko: '탐색 및 표시', en: 'Navigation and display' })} actions={<SectionDirtyBadge dirty={isSectionDirty('appearance')} />}>
          <div className="grid gap-4 md:grid-cols-2">
            <ToggleRow>
              <input type="checkbox" checked={generalDraft.enableGallery ?? true} onChange={(event) => onPatchGeneral({ enableGallery: event.target.checked })} />
              {t({ ko: '갤러리 기능 사용', en: 'Enable gallery features' })}
            </ToggleRow>
            <ToggleRow>
              <input type="checkbox" checked={generalDraft.showRatingBadges ?? true} onChange={(event) => onPatchGeneral({ showRatingBadges: event.target.checked })} />
              {t({ ko: '등급 배지 표시', en: 'Show rating badges' })}
            </ToggleRow>
            <Inset className="md:col-span-2">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t({ ko: '상단 네비 표시', en: 'Header navigation' })}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {HEADER_NAVIGATION_OPTIONS.map((option) => (
                  <ToggleRow key={option.key}>
                    <input
                      type="checkbox"
                      checked={(generalDraft.headerNavigation ?? DEFAULT_HEADER_NAVIGATION_SETTINGS)[option.key] ?? true}
                      onChange={(event) => updateHeaderNavigationItem(option.key, event.target.checked)}
                    />
                    {t(option.label)}
                  </ToggleRow>
                ))}
              </div>
            </Inset>
          </div>
        </Section>
      ) : null}

      {visibleSections.has('library') ? (
        <Section variant="settings" heading={t({ ko: '라이브러리 동작', en: 'Library behavior' })} actions={<SectionDirtyBadge dirty={isSectionDirty('library')} />}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t({ ko: '유사/중복 검사', en: 'Similar/duplicate check' })}>
              <Select
                variant="settings"
                value={generalDraft.imageSimilarityCheckMode ?? 'always'}
                onChange={(event) => onPatchGeneral({ imageSimilarityCheckMode: event.target.value as GeneralSettings['imageSimilarityCheckMode'] })}
              >
                <option value="manual">{t({ ko: '수동 실행', en: 'Manual' })}</option>
                <option value="always">{t({ ko: '상세 열 때 자동 실행', en: 'Auto on detail open' })}</option>
              </Select>
            </Field>
          </div>
        </Section>
      ) : null}

      {visibleSections.has('safety') ? (
        <Section variant="settings" heading={t({ ko: '안전 및 정리', en: 'Safety and cleanup' })} actions={<SectionDirtyBadge dirty={isSectionDirty('safety')} />}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t({ ko: '휴지통 경로', en: 'Recycle bin path' })}>
              <Input
                variant="settings"
                value={generalDraft.deleteProtection.recycleBinPath}
                onChange={(event) => onPatchDeleteProtection({ recycleBinPath: event.target.value })}
                placeholder="RecycleBin"
              />
            </Field>
            <Field label={t({ ko: '생성 히스토리 최대 항목 수', en: 'Generation history maximum items' })}>
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
            </Field>
            <ToggleRow className="md:col-span-2">
              <input type="checkbox" checked={generalDraft.deleteProtection.enabled} onChange={(event) => onPatchDeleteProtection({ enabled: event.target.checked })} />
              {t({ ko: '삭제할 때 휴지통으로 보호', en: 'Protect deleted files with the recycle bin' })}
            </ToggleRow>
            <ToggleRow className="md:col-span-2">
              <input type="checkbox" checked={generalDraft.autoCleanupCanvasOnShutdown ?? false} onChange={(event) => onPatchGeneral({ autoCleanupCanvasOnShutdown: event.target.checked })} />
              {t({ ko: '종료 시 캔버스 임시 데이터 자동 정리', en: 'Clean up temporary canvas data on exit' })}
            </ToggleRow>
            <ToggleRow className="md:col-span-2">
              <input
                type="checkbox"
                checked={generalDraft.applyRatingSafetyToGenerationHistory ?? false}
                onChange={(event) => onPatchGeneral({ applyRatingSafetyToGenerationHistory: event.target.checked })}
              />
              {t({ ko: '생성 히스토리에도 등급 표시 규칙 적용', en: 'Apply rating visibility rules to generation history' })}
            </ToggleRow>
          </div>
        </Section>
      ) : null}
    </div>
  )
}
