export type SettingsTab = 'general' | 'library' | 'media' | 'auto' | 'generation' | 'accounts' | 'system' | 'maintenance'

export type SettingsTabGroup = 'personalization' | 'library' | 'services' | 'administration'

export interface SettingsTabItem {
  value: SettingsTab
  group: SettingsTabGroup
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  { value: 'general', group: 'personalization' },
  { value: 'library', group: 'library' },
  { value: 'media', group: 'library' },
  { value: 'auto', group: 'services' },
  { value: 'generation', group: 'services' },
  { value: 'accounts', group: 'administration' },
  { value: 'system', group: 'administration' },
  { value: 'maintenance', group: 'administration' },
]

const SETTINGS_TAB_VALUES = new Set<SettingsTab>(SETTINGS_TAB_ITEMS.map((item) => item.value))

/** Old `?section=` ids (earlier layouts and bookmarks) mapped to the tab that now holds their content. */
const LEGACY_SETTINGS_TAB_MAP: Record<string, SettingsTab> = {
  appearance: 'general',
  integration: 'generation',
  'integration-tools': 'generation',
  folders: 'library',
  metadata: 'library',
  security: 'accounts',
  'image-save': 'media',
  'llm-connections': 'generation',
}

/** Resolve current and legacy settings links to the canonical section. */
export function parseSettingsTab(value: string | null): SettingsTab {
  if (!value) return 'general'
  if (SETTINGS_TAB_VALUES.has(value as SettingsTab)) return value as SettingsTab
  return LEGACY_SETTINGS_TAB_MAP[value] ?? 'general'
}
