export type SettingsTab = 'folders' | 'appearance' | 'security' | 'auto' | 'metadata' | 'image-save'

export interface SettingsTabItem {
  value: SettingsTab
  label: string
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  { value: 'folders', label: 'Watch Folders' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'security', label: '보안' },
  { value: 'auto', label: 'Auto' },
  { value: 'metadata', label: 'Metadata' },
  { value: 'image-save', label: '이미지 저장' },
]
