export type SettingsTab = 'folders' | 'auto' | 'metadata'

export interface SettingsTabItem {
  value: SettingsTab
  label: string
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  { value: 'folders', label: 'Watch Folders' },
  { value: 'auto', label: 'Auto' },
  { value: 'metadata', label: 'Metadata' },
]
