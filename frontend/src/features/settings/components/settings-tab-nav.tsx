import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { getNavigationItemClassName } from '@/components/common/navigation-item'
import { type TranslationDictionary, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { SETTINGS_TAB_ITEMS, type SettingsTab } from '../settings-tabs'

interface SettingsTabNavProps {
  activeTab: SettingsTab
  onChange: (tab: SettingsTab) => void
}

const SETTINGS_TAB_LABELS: Record<SettingsTab, TranslationDictionary> = {
  general: { ko: '일반', en: 'General' },
  folders: { ko: '감시 폴더', en: 'Watched folders' },
  appearance: { ko: '외형', en: 'Appearance' },
  security: { ko: '보안', en: 'Security' },
  auto: { ko: '자동화', en: 'Automation' },
  metadata: { ko: '메타데이터', en: 'Metadata' },
  'image-save': { ko: '미디어 생성/저장', en: 'Media generation/save' },
  'llm-connections': { ko: 'LLM 설정', en: 'LLM settings' },
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
      <div className="space-y-1.5">
        {SETTINGS_TAB_ITEMS.map((item) => (
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
    </ExplorerSidebar>
  )
}
