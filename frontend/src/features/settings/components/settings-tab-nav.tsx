import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { getNavigationItemClassName } from '@/components/common/navigation-item'
import { type TranslationDictionary, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { SETTINGS_TAB_ITEMS, type SettingsTab, type SettingsTabGroup } from '../settings-tabs'

interface SettingsTabNavProps {
  activeTab: SettingsTab
  onChange: (tab: SettingsTab) => void
}

const SETTINGS_TAB_LABELS: Record<SettingsTab, TranslationDictionary> = {
  general: { ko: '일반', en: 'General' },
  appearance: { ko: '화면 및 탐색', en: 'Appearance and navigation' },
  library: { ko: '라이브러리 및 가져오기', en: 'Library and imports' },
  media: { ko: '미디어 처리', en: 'Media processing' },
  auto: { ko: '자동화 및 분석', en: 'Automation and analysis' },
  generation: { ko: '생성 및 AI', en: 'Generation and AI' },
  integration: { ko: '연동', en: 'Integrations' },
  system: { ko: '계정 및 시스템', en: 'Accounts and system' },
}

const SETTINGS_TAB_GROUP_LABELS: Record<SettingsTabGroup, TranslationDictionary> = {
  personalization: { ko: '기본 환경', en: 'Preferences' },
  library: { ko: '콘텐츠', en: 'Content' },
  services: { ko: '기능 및 서비스', en: 'Features and services' },
  administration: { ko: '관리', en: 'Administration' },
}

export function SettingsTabNav({ activeTab, onChange }: SettingsTabNavProps) {
  const { t } = useI18n()

  return (
    <ExplorerSidebar
      title={t({ ko: '설정 항목', en: 'Settings sections' })}
      floatingFrame
      floatingLockStorageKey="conai:settings:sidebar-locked"
      className="min-[800px]:sticky min-[800px]:top-24 min-[800px]:self-start"
    >
      <div className="space-y-4">
        {Object.keys(SETTINGS_TAB_GROUP_LABELS).map((groupKey) => {
          const group = groupKey as SettingsTabGroup
          const items = SETTINGS_TAB_ITEMS.filter((item) => item.group === group)

          return (
            <div key={group} className="space-y-1.5">
              <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t(SETTINGS_TAB_GROUP_LABELS[group])}
              </div>
              {items.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onChange(item.value)}
                  className={cn(
                    getNavigationItemClassName({
                      active: activeTab === item.value,
                      className: 'py-2.5 text-sm font-semibold',
                    }),
                    'rounded-sm',
                  )}
                >
                  {t(SETTINGS_TAB_LABELS[item.value])}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </ExplorerSidebar>
  )
}
