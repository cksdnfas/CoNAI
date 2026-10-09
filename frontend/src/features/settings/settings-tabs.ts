import type { TranslationDictionary } from '@/i18n'

export type SettingsTab = 'general' | 'library' | 'media' | 'auto' | 'generation' | 'chat' | 'posts' | 'llm' | 'accounts' | 'system' | 'maintenance'

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
  { value: 'chat', group: 'services' },
  { value: 'posts', group: 'services' },
  { value: 'llm', group: 'services' },
  { value: 'accounts', group: 'administration' },
  { value: 'system', group: 'administration' },
  { value: 'maintenance', group: 'administration' },
]

/** Sidebar row label and toolbar title of each section. */
export const SETTINGS_TAB_LABELS: Record<SettingsTab, TranslationDictionary> = {
  general: { ko: '일반 및 화면', en: 'General and appearance' },
  library: { ko: '라이브러리', en: 'Library' },
  media: { ko: '미디어 처리', en: 'Media processing' },
  auto: { ko: '자동화 및 분석', en: 'Automation and analysis' },
  generation: { ko: '생성 및 AI', en: 'Generation and AI' },
  chat: { ko: '채팅', en: 'Chat' },
  posts: { ko: '게시판', en: 'Posts' },
  llm: { ko: 'LLM', en: 'LLM' },
  accounts: { ko: '계정·권한', en: 'Accounts and access' },
  system: { ko: '시스템', en: 'System' },
  maintenance: { ko: '유지보수', en: 'Maintenance' },
}

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
  'llm-connections': 'llm',
}

/** Resolve current and legacy settings links to the canonical section. */
export function parseSettingsTab(value: string | null): SettingsTab {
  if (!value) return 'general'
  if (SETTINGS_TAB_VALUES.has(value as SettingsTab)) return value as SettingsTab
  return LEGACY_SETTINGS_TAB_MAP[value] ?? 'general'
}
