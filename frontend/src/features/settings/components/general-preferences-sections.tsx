import { Archive, CircleUserRound, Film, FolderTree, Images, LayoutGrid, ListTodo, Map as MapIcon, MessageSquare, MessageSquareText, Search, Settings2, Sparkles, Upload, type LucideIcon } from 'lucide-react'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { RowGroup } from '@/components/ui/row-group'
import { ToggleChip } from '@/components/ui/chip'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { useI18n } from '@/i18n'
import { MAX_RECYCLE_BIN_RETENTION_DAYS, type GeneralSettings, type HeaderNavigationItemKey } from '@conai/shared'
import { DEFAULT_HEADER_NAVIGATION_SETTINGS } from '@/lib/settings-defaults'
import { SettingsSwitchRow } from './settings-switch-row'
import { SectionDirtyBadge } from './settings-section-status'
import { SettingsLabelTip } from './settings-label-tip'
import { SETTINGS_CONTROL_CLASS, SettingsRowsSkeleton } from './settings-rows'

export type GeneralPreferenceSection = 'basic' | 'appearance' | 'library' | 'safety'

/** Days offered when the automatic RecycleBin cleanup is switched on. */
const DEFAULT_RECYCLE_BIN_RETENTION_DAYS = 30

interface GeneralPreferencesSectionsProps {
  sections: GeneralPreferenceSection[]
  generalDraft: GeneralSettings | null
  onPatchGeneral: (patch: Partial<GeneralSettings>) => void
  onPatchDeleteProtection: (patch: Partial<GeneralSettings['deleteProtection']>) => void
  /** Whether a section has edits waiting in the page save bar. */
  isSectionDirty: (section: GeneralPreferenceSection) => boolean
}

const HEADER_NAVIGATION_OPTIONS: Array<{ key: HeaderNavigationItemKey; icon: LucideIcon; label: { ko: string; en: string } }> = [
  { key: 'access', icon: MapIcon, label: { ko: '이용 가능 페이지', en: 'Available pages' } },
  { key: 'home', icon: Images, label: { ko: '홈', en: 'Home' } },
  { key: 'groups', icon: FolderTree, label: { ko: '그룹', en: 'Groups' } },
  { key: 'prompts', icon: MessageSquareText, label: { ko: '프롬프트', en: 'Prompts' } },
  { key: 'generation', icon: Sparkles, label: { ko: '생성', en: 'Generation' } },
  { key: 'sprite', icon: Film, label: { ko: '스프라이트', en: 'Sprites' } },
  { key: 'chat', icon: MessageSquare, label: { ko: '채팅', en: 'Chat' } },
  { key: 'upload', icon: Upload, label: { ko: '업로드', en: 'Upload' } },
  { key: 'files', icon: Archive, label: { ko: '파일 보관함', en: 'Files' } },
  { key: 'wallpaper', icon: LayoutGrid, label: { ko: '월페이퍼', en: 'Wallpaper' } },
  { key: 'settings', icon: Settings2, label: { ko: '설정', en: 'Settings' } },
  { key: 'search', icon: Search, label: { ko: '검색', en: 'Search' } },
  { key: 'queue', icon: ListTodo, label: { ko: '대기열', en: 'Queue' } },
  { key: 'account', icon: CircleUserRound, label: { ko: '사용자', en: 'User' } },
]

/** Render app-wide preferences in their user-facing settings category, as flat hairline rows. */
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
    return <SettingsRowsSkeleton rows={4} />
  }

  const headerNavigation = generalDraft.headerNavigation ?? DEFAULT_HEADER_NAVIGATION_SETTINGS
  const languageLabel = t({ ko: '언어', en: 'Language' })
  const similarityLabel = t({ ko: '유사/중복 검사', en: 'Similar/duplicate check' })
  const retentionLabel = t({ ko: '휴지통 보관 기간 (일)', en: 'Keep in recycle bin (days)' })
  const retentionDays = generalDraft.deleteProtection.recycleBinRetentionDays ?? 0
  const historyMaxLabel = t({ ko: '생성 히스토리 최대 항목 수', en: 'Generation history maximum items' })

  return (
    <div className="space-y-8">
      {visibleSections.has('basic') ? (
        <RowGroup heading={t({ ko: '기본', en: 'Basics' })} actions={<SectionDirtyBadge dirty={isSectionDirty('basic')} />}>
          <SettingRow
            label={languageOverride
              ? <SettingsLabelTip label={languageLabel} tip={t({ ko: '이 브라우저는 계정 메뉴의 언어 선택이 우선', en: 'This browser uses its account-menu choice' })} />
              : languageLabel}
            controlClassName={SETTINGS_CONTROL_CLASS}
          >
            <Select
              variant="settings"
              aria-label={languageLabel}
              value={generalDraft.language}
              onChange={(event) => onPatchGeneral({ language: event.target.value as GeneralSettings['language'] })}
            >
              <option value="ko">{t({ ko: '한국어', en: 'Korean' })}</option>
              <option value="en">{t({ ko: '영어', en: 'English' })}</option>
            </Select>
          </SettingRow>
          <SettingsSwitchRow
            checked={generalDraft.promptForDownloadLocation ?? false}
            onCheckedChange={(checked) => onPatchGeneral({ promptForDownloadLocation: checked })}
            label={t({ ko: '다운로드할 때 파일명과 위치 확인', en: 'Ask for file name and save location' })}
          />
        </RowGroup>
      ) : null}

      {visibleSections.has('appearance') ? (
        <RowGroup heading={t({ ko: '탐색 및 표시', en: 'Navigation and display' })} actions={<SectionDirtyBadge dirty={isSectionDirty('appearance')} />}>
          <SettingsSwitchRow
            checked={generalDraft.enableGallery ?? true}
            onCheckedChange={(checked) => onPatchGeneral({ enableGallery: checked })}
            label={t({ ko: '갤러리 기능 사용', en: 'Enable gallery features' })}
          />
          <SettingsSwitchRow
            checked={generalDraft.showRatingBadges ?? true}
            onCheckedChange={(checked) => onPatchGeneral({ showRatingBadges: checked })}
            label={t({ ko: '등급 배지 표시', en: 'Show rating badges' })}
          />
          <SettingRow label={t({ ko: '상단 메뉴', en: 'Header menu' })} align="start" controlClassName="justify-start sm:max-w-xl sm:justify-end">
            {HEADER_NAVIGATION_OPTIONS.map((option) => {
              const Icon = option.icon
              const pressed = headerNavigation[option.key] ?? true
              return (
                <ToggleChip key={option.key} pressed={pressed} onClick={() => updateHeaderNavigationItem(option.key, !pressed)}>
                  <Icon aria-hidden />
                  {t(option.label)}
                </ToggleChip>
              )
            })}
          </SettingRow>
        </RowGroup>
      ) : null}

      {visibleSections.has('library') ? (
        <RowGroup heading={t({ ko: '라이브러리 동작', en: 'Library behavior' })} actions={<SectionDirtyBadge dirty={isSectionDirty('library')} />}>
          <SettingRow label={similarityLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Select
              variant="settings"
              aria-label={similarityLabel}
              value={generalDraft.imageSimilarityCheckMode ?? 'always'}
              onChange={(event) => onPatchGeneral({ imageSimilarityCheckMode: event.target.value as GeneralSettings['imageSimilarityCheckMode'] })}
            >
              <option value="manual">{t({ ko: '수동 실행', en: 'Manual' })}</option>
              <option value="always">{t({ ko: '상세 열 때 자동 실행', en: 'Auto on detail open' })}</option>
            </Select>
          </SettingRow>
        </RowGroup>
      ) : null}

      {visibleSections.has('safety') ? (
        <RowGroup heading={t({ ko: '안전 및 정리', en: 'Safety and cleanup' })} actions={<SectionDirtyBadge dirty={isSectionDirty('safety')} />}>
          <SettingsSwitchRow
            checked={generalDraft.deleteProtection.enabled}
            onCheckedChange={(checked) => onPatchDeleteProtection({ enabled: checked })}
            label={t({ ko: '삭제할 때 휴지통으로 보호', en: 'Protect deleted files with the recycle bin' })}
          />
          <SettingsSwitchRow
            checked={retentionDays > 0}
            onCheckedChange={(checked) => onPatchDeleteProtection({ recycleBinRetentionDays: checked ? DEFAULT_RECYCLE_BIN_RETENTION_DAYS : 0 })}
            label={t({ ko: '휴지통 자동 비우기', en: 'Empty the recycle bin automatically' })}
          />
          {retentionDays > 0 ? (
            <SettingRow label={retentionLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
              <NumberStepperInput
                variant="settings"
                aria-label={retentionLabel}
                min={1}
                max={MAX_RECYCLE_BIN_RETENTION_DAYS}
                step={1}
                value={retentionDays}
                onValueCommit={(nextValue) => {
                  const parsedValue = Number.parseInt(nextValue, 10)
                  if (Number.isFinite(parsedValue)) {
                    onPatchDeleteProtection({ recycleBinRetentionDays: Math.min(MAX_RECYCLE_BIN_RETENTION_DAYS, Math.max(1, parsedValue)) })
                  }
                }}
              />
            </SettingRow>
          ) : null}
          <SettingRow label={historyMaxLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
            <NumberStepperInput
              variant="settings"
              aria-label={historyMaxLabel}
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
          </SettingRow>
          <SettingsSwitchRow
            checked={generalDraft.autoCleanupCanvasOnShutdown ?? false}
            onCheckedChange={(checked) => onPatchGeneral({ autoCleanupCanvasOnShutdown: checked })}
            label={t({ ko: '종료 시 캔버스 임시 데이터 자동 정리', en: 'Clean up temporary canvas data on exit' })}
          />
          <SettingsSwitchRow
            checked={generalDraft.applyRatingSafetyToGenerationHistory ?? false}
            onCheckedChange={(checked) => onPatchGeneral({ applyRatingSafetyToGenerationHistory: checked })}
            label={t({ ko: '생성 히스토리에도 등급 표시 규칙 적용', en: 'Apply rating visibility rules to generation history' })}
          />
        </RowGroup>
      ) : null}
    </div>
  )
}
