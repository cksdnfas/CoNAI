export type SettingsTab = 'general' | 'folders' | 'appearance' | 'security' | 'auto' | 'metadata' | 'image-save' | 'integration-tools' | 'llm-connections'

export interface SettingsTabItem {
  value: SettingsTab
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  { value: 'general' },
  { value: 'folders' },
  { value: 'appearance' },
  { value: 'security' },
  { value: 'auto' },
  { value: 'metadata' },
  { value: 'image-save' },
  { value: 'integration-tools' },
  { value: 'llm-connections' },
]
