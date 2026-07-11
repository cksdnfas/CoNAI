export type SettingsTab = 'general' | 'appearance' | 'library' | 'media' | 'auto' | 'generation' | 'integration' | 'system'

export type SettingsTabGroup = 'personalization' | 'library' | 'services' | 'administration'

export interface SettingsTabItem {
  value: SettingsTab
  group: SettingsTabGroup
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  { value: 'general', group: 'personalization' },
  { value: 'appearance', group: 'personalization' },
  { value: 'library', group: 'library' },
  { value: 'media', group: 'library' },
  { value: 'auto', group: 'services' },
  { value: 'generation', group: 'services' },
  { value: 'integration', group: 'services' },
  { value: 'system', group: 'administration' },
]

const SETTINGS_TAB_VALUES = new Set<SettingsTab>(SETTINGS_TAB_ITEMS.map((item) => item.value))

const LEGACY_SETTINGS_TAB_MAP: Record<string, SettingsTab> = {
  folders: 'library',
  metadata: 'library',
  security: 'system',
  'image-save': 'media',
  'integration-tools': 'integration',
  'llm-connections': 'generation',
}

/** Resolve current and legacy settings links to the canonical section. */
export function parseSettingsTab(value: string | null): SettingsTab {
  if (!value) return 'general'
  if (SETTINGS_TAB_VALUES.has(value as SettingsTab)) return value as SettingsTab
  return LEGACY_SETTINGS_TAB_MAP[value] ?? 'general'
}
