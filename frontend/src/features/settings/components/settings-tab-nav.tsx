import { cn } from '@/lib/utils'
import { SETTINGS_TAB_ITEMS, type SettingsTab } from '../settings-tabs'

interface SettingsTabNavProps {
  activeTab: SettingsTab
  onChange: (tab: SettingsTab) => void
}

export function SettingsTabNav({ activeTab, onChange }: SettingsTabNavProps) {
  return (
    <aside className="rounded-sm bg-surface-lowest p-4 min-[800px]:sticky min-[800px]:top-24 min-[800px]:self-start">
      <div className="mb-4">
        <h2 className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">Sections</h2>
      </div>

      <div className="space-y-2">
        {SETTINGS_TAB_ITEMS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn(
              'w-full rounded-sm px-3 py-3 text-left text-sm font-semibold transition-colors',
              activeTab === item.value
                ? 'bg-surface-container text-primary'
                : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </aside>
  )
}
