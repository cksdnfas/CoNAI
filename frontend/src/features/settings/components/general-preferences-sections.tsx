import { useState } from 'react'
import { ChatFilledMark } from '@/features/codex-chat/chat-page-context'
import { ChatFilledLabel } from './settings-filled-label'
import { CircleUserRound, ListTodo, Search, type LucideIcon } from 'lucide-react'
import { HEADER_PAGE_PATHS } from '@/components/layout/app-navigation'
import { PAGE_ACCESS_CATALOG } from '@/features/auth/page-access-catalog'
import { usePluginPages } from '@/features/plugins/use-plugin-pages'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { RowGroup } from '@/components/ui/row-group'
import { ToggleChip } from '@/components/ui/chip'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { useI18n } from '@/i18n'
import { HEADER_NAVIGATION_TOOL_KEYS, MAX_RECYCLE_BIN_RETENTION_DAYS, normalizeHeaderNavigationOrder, type GeneralSettings, type HeaderNavigationItemKey, type HeaderNavigationPageKey } from '@conai/shared'
import { DEFAULT_HEADER_NAVIGATION_SETTINGS } from '@/lib/settings-defaults'
import { cn } from '@/lib/utils'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { SectionDirtyBadge } from './settings-section-status'
import { SettingsLabelTip } from './settings-label-tip'
import { SettingsRowsSkeleton } from './settings-rows'

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

/** The header's right-side tools keep their place; only the pinned pages reorder. */
const HEADER_TOOL_OPTIONS: Record<typeof HEADER_NAVIGATION_TOOL_KEYS[number], { icon: LucideIcon; label: { ko: string; en: string } }> = {
  queue: { icon: ListTodo, label: { ko: '대기열', en: 'Queue' } },
  search: { icon: Search, label: { ko: '검색', en: 'Search' } },
  account: { icon: CircleUserRound, label: { ko: '사용자', en: 'User' } },
}

/** Render app-wide preferences in their user-facing settings category, as flat hairline rows. */
export function GeneralPreferencesSections({
  sections,
  generalDraft,
  onPatchGeneral,
  onPatchDeleteProtection,
  isSectionDirty,
}: GeneralPreferencesSectionsProps) {
  const { t, languageOverride } = useI18n()
  const pluginPages = usePluginPages()
  // A pinnable page's chip: the catalog's name and icon (a plugin page: its own).
  const pageOption = (key: HeaderNavigationPageKey): { icon: LucideIcon; label: string } | null => {
    const plugin = pluginPages.find((page) => page.id === key)
    if (plugin) return { icon: plugin.icon, label: plugin.title }
    const entry = PAGE_ACCESS_CATALOG.find((item) => item.path === HEADER_PAGE_PATHS[key as keyof typeof HEADER_PAGE_PATHS])
    return entry ? { icon: entry.icon, label: t(entry.labelKey) } : null
  }
  const visibleSections = new Set(sections)
  const [draggedPage, setDraggedPage] = useState<HeaderNavigationPageKey | null>(null)
  const [dropTargetPage, setDropTargetPage] = useState<HeaderNavigationPageKey | null>(null)

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

  const moveHeaderPage = (dragged: HeaderNavigationPageKey, target: HeaderNavigationPageKey) => {
    if (!generalDraft || dragged === target) return
    const current = normalizeHeaderNavigationOrder(generalDraft.headerNavigationOrder, pluginPages.map((page) => page.id))
    const next = current.filter((key) => key !== dragged)
    next.splice(next.indexOf(target) + (current.indexOf(dragged) < current.indexOf(target) ? 1 : 0), 0, dragged)
    onPatchGeneral({ headerNavigationOrder: next })
  }

  if (!generalDraft) {
    return <SettingsRowsSkeleton rows={4} />
  }

  const headerNavigation = generalDraft.headerNavigation ?? DEFAULT_HEADER_NAVIGATION_SETTINGS
  const headerNavigationOrder = normalizeHeaderNavigationOrder(generalDraft.headerNavigationOrder, pluginPages.map((page) => page.id))
  const headerMenuLabel = t({ ko: '상단 고정 페이지', en: 'Pinned pages' })
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
            label={<ChatFilledLabel fieldId="language">{languageOverride
              ? <SettingsLabelTip label={languageLabel} tip={t({ ko: '이 브라우저는 계정 메뉴의 언어 선택이 우선', en: 'This browser uses its account-menu choice' })} />
              : languageLabel}</ChatFilledLabel>}
            controlWidth="standard"
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
            label={<ChatFilledLabel fieldId="promptForDownloadLocation">{t({ ko: '다운로드할 때 파일명과 위치 확인', en: 'Ask for file name and save location' })}</ChatFilledLabel>}
          />
        </RowGroup>
      ) : null}

      {visibleSections.has('appearance') ? (
        <RowGroup heading={t({ ko: '탐색 및 표시', en: 'Navigation and display' })} actions={<SectionDirtyBadge dirty={isSectionDirty('appearance')} />}>
          <SettingsSwitchRow
            checked={generalDraft.enableGallery ?? true}
            onCheckedChange={(checked) => onPatchGeneral({ enableGallery: checked })}
            label={<ChatFilledLabel fieldId="enableGallery">{t({ ko: '갤러리 기능 사용', en: 'Enable gallery features' })}</ChatFilledLabel>}
          />
          <SettingsSwitchRow
            checked={generalDraft.showRatingBadges ?? true}
            onCheckedChange={(checked) => onPatchGeneral({ showRatingBadges: checked })}
            label={<ChatFilledLabel fieldId="showRatingBadges">{t({ ko: '등급 배지 표시', en: 'Show rating badges' })}</ChatFilledLabel>}
          />
          <SettingRow
            label={<ChatFilledLabel fieldId="headerNavigation">{headerMenuLabel}</ChatFilledLabel>}
            align="start"
            controlClassName="justify-start sm:max-w-xl sm:justify-end"
          >
            {headerNavigationOrder.map((key) => {
              const option = pageOption(key)
              if (!option) return null
              const Icon = option.icon
              // Pressed = pinned; a page left unpinned (plugin pages by default) sits in its menu group.
              const pressed = headerNavigation[key] === true
              return (
                <span key={key} className={cn('inline-flex cursor-grab active:cursor-grabbing', draggedPage === key && 'opacity-50', dropTargetPage === key && draggedPage !== key && 'ring-2 ring-primary/60')}>
                <ToggleChip
                  tone="neutral"
                  pressed={pressed}
                  onClick={() => updateHeaderNavigationItem(key, !pressed)}
                  draggable
                  onDragStart={(event) => { setDraggedPage(key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key) }}
                  onDragEnd={() => { setDraggedPage(null); setDropTargetPage(null) }}
                  onDragOver={(event) => { if (draggedPage) { event.preventDefault(); setDropTargetPage(key) } }}
                  onDragLeave={() => setDropTargetPage((current) => (current === key ? null : current))}
                  onDrop={(event) => { event.preventDefault(); if (draggedPage) moveHeaderPage(draggedPage, key); setDraggedPage(null); setDropTargetPage(null) }}
                >
                  <Icon aria-hidden />
                  {option.label}
                  <ChatFilledMark fieldId={`headerNavigation.${key}`} />
                </ToggleChip>
                </span>
              )
            })}
          </SettingRow>
          <SettingRow
            label={<ChatFilledLabel fieldId="headerTools" />}
            controlClassName="justify-start sm:max-w-xl sm:justify-end"
          >
            {HEADER_NAVIGATION_TOOL_KEYS.map((key) => {
              const { icon: Icon, label } = HEADER_TOOL_OPTIONS[key]
              const pressed = headerNavigation[key] ?? true
              return (
                <ToggleChip key={key} tone="neutral" pressed={pressed} onClick={() => updateHeaderNavigationItem(key, !pressed)}>
                  <Icon aria-hidden />
                  {t(label)}
                  <ChatFilledMark fieldId={`headerNavigation.${key}`} />
                </ToggleChip>
              )
            })}
          </SettingRow>
        </RowGroup>
      ) : null}

      {visibleSections.has('library') ? (
        <RowGroup heading={t({ ko: '라이브러리 동작', en: 'Library behavior' })} actions={<SectionDirtyBadge dirty={isSectionDirty('library')} />}>
          <SettingRow label={<ChatFilledLabel fieldId="imageSimilarityCheckMode">{similarityLabel}</ChatFilledLabel>} controlWidth="standard">
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
            label={<ChatFilledLabel fieldId="deleteProtection.enabled">{t({ ko: '삭제할 때 휴지통으로 보호', en: 'Protect deleted files with the recycle bin' })}</ChatFilledLabel>}
          />
          <SettingsSwitchRow
            checked={retentionDays > 0}
            onCheckedChange={(checked) => onPatchDeleteProtection({ recycleBinRetentionDays: checked ? DEFAULT_RECYCLE_BIN_RETENTION_DAYS : 0 })}
            label={<ChatFilledLabel fieldId="deleteProtection.recycleBinRetentionDays">{t({ ko: '휴지통 자동 비우기', en: 'Empty the recycle bin automatically' })}</ChatFilledLabel>}
          />
          {retentionDays > 0 ? (
            <SettingRow label={<ChatFilledLabel fieldId="deleteProtection.recycleBinRetentionDays">{retentionLabel}</ChatFilledLabel>} controlWidth="standard">
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
          <SettingRow label={<ChatFilledLabel fieldId="generationHistoryMaxItems">{historyMaxLabel}</ChatFilledLabel>} controlWidth="standard">
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
            label={<ChatFilledLabel fieldId="autoCleanupCanvasOnShutdown">{t({ ko: '종료 시 캔버스 임시 데이터 자동 정리', en: 'Clean up temporary canvas data on exit' })}</ChatFilledLabel>}
          />
          <SettingsSwitchRow
            checked={generalDraft.applyRatingSafetyToGenerationHistory ?? false}
            onCheckedChange={(checked) => onPatchGeneral({ applyRatingSafetyToGenerationHistory: checked })}
            label={<ChatFilledLabel fieldId="applyRatingSafetyToGenerationHistory">{t({ ko: '생성 히스토리에도 등급 표시 규칙 적용', en: 'Apply rating visibility rules to generation history' })}</ChatFilledLabel>}
          />
        </RowGroup>
      ) : null}
    </div>
  )
}
