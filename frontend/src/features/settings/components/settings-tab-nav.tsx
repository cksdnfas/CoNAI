import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { getNavigationItemClassName } from '@/components/common/navigation-item'
import { cn } from '@/lib/utils'
import { SETTINGS_TAB_ITEMS, type SettingsTab } from '../settings-tabs'

interface SettingsTabNavProps {
  activeTab: SettingsTab
  onChange: (tab: SettingsTab) => void
}

export function SettingsTabNav({ activeTab, onChange }: SettingsTabNavProps) {
  return (
    <ExplorerSidebar title="설정 항목" floatingFrame floatingLockStorageKey="conai:settings:sidebar-locked" className="min-[800px]:sticky min-[800px]:top-24 min-[800px]:self-start">
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
            {item.label}
          </button>
        ))}
      </div>
    </ExplorerSidebar>
  )
}
