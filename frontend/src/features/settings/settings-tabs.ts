export type SettingsTab = 'folders' | 'appearance' | 'auto' | 'metadata'

export interface SettingsTabItem {
  value: SettingsTab
  label: string
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  { value: 'folders', label: 'Watch Folders' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'auto', label: 'Auto' },
  { value: 'metadata', label: 'Metadata' },
]
