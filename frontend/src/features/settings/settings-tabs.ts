export type SettingsTab = 'folders' | 'appearance' | 'security' | 'auto' | 'metadata' | 'image-save'

export interface SettingsTabItem {
  value: SettingsTab
  label: string
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  { value: 'folders', label: '감시 폴더' },
  { value: 'appearance', label: '외형' },
  { value: 'security', label: '보안' },
  { value: 'auto', label: '자동화' },
  { value: 'metadata', label: '메타데이터' },
  { value: 'image-save', label: '이미지 저장' },
]
