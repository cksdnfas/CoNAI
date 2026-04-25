export type SettingsTab = 'general' | 'folders' | 'appearance' | 'security' | 'auto' | 'metadata' | 'image-save' | 'llm-connections'

export interface SettingsTabItem {
  value: SettingsTab
  label: string
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  { value: 'general', label: '일반' },
  { value: 'folders', label: '감시 폴더' },
  { value: 'appearance', label: '외형' },
  { value: 'security', label: '보안' },
  { value: 'auto', label: '자동화' },
  { value: 'metadata', label: '메타데이터' },
  { value: 'image-save', label: '미디어 생성/저장' },
  { value: 'llm-connections', label: 'LLM 설정' },
]
