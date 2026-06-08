export type SettingsTab = 'general' | 'release-readiness' | 'folders' | 'appearance' | 'security' | 'auto' | 'metadata' | 'image-save' | 'integration-tools' | 'llm-connections'

export interface SettingsTabItem {
  value: SettingsTab
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  { value: 'general' },
  { value: 'release-readiness' },
  { value: 'folders' },
  { value: 'appearance' },
  { value: 'security' },
  { value: 'auto' },
  { value: 'metadata' },
  { value: 'image-save' },
  { value: 'integration-tools' },
  { value: 'llm-connections' },
]
