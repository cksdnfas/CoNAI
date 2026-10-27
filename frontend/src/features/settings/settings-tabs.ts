import type { TranslationDictionary } from '@/i18n'
import { SETTINGS_ROW_BY_ID } from '@conai/shared'

export type SettingsTab = 'mine' | 'general' | 'library' | 'media' | 'auto' | 'generation' | 'chat' | 'posts' | 'llm' | 'plugins' | 'accounts' | 'system' | 'maintenance'

export type SettingsTabGroup = 'mine' | 'shared'

export interface SettingsTabItem {
  value: SettingsTab
  group: SettingsTabGroup
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  { value: 'mine', group: 'mine' },
  { value: 'general', group: 'shared' },
  { value: 'library', group: 'shared' },
  { value: 'media', group: 'shared' },
  { value: 'generation', group: 'shared' },
  { value: 'llm', group: 'shared' },
  { value: 'chat', group: 'shared' },
  { value: 'posts', group: 'shared' },
  { value: 'auto', group: 'shared' },
  { value: 'accounts', group: 'shared' },
  { value: 'plugins', group: 'shared' },
  { value: 'system', group: 'shared' },
  { value: 'maintenance', group: 'shared' },
]

/** Sidebar row label and toolbar title of each section. */
export const SETTINGS_TAB_LABELS: Record<SettingsTab, TranslationDictionary> = {
  mine: { ko: '페르소나·플래그', en: 'Personas and flags' },
  general: { ko: '공용 화면 테마', en: 'Shared appearance' },
  library: { ko: '라이브러리', en: 'Library' },
  media: { ko: '미디어 처리', en: 'Media processing' },
  auto: { ko: '자동 분석', en: 'Automatic analysis' },
  generation: { ko: '생성 엔진', en: 'Generation engines' },
  llm: { ko: 'AI 연결', en: 'AI connections' },
  chat: { ko: '채팅', en: 'Chat' },
  posts: { ko: '게시판·지식', en: 'Posts and knowledge' },
  accounts: { ko: '계정·권한', en: 'Accounts and access' },
  plugins: { ko: '플러그인 관리', en: 'Plugin management' },
  system: { ko: '시스템', en: 'System' },
  maintenance: { ko: '유지보수', en: 'Maintenance' },
}

const SETTINGS_TAB_VALUES = new Set<SettingsTab>(SETTINGS_TAB_ITEMS.map((item) => item.value))

/** Old `?section=` ids (earlier layouts and bookmarks) mapped to the tab that now holds their content. */
export const LEGACY_SETTINGS_TAB_MAP: Record<string, SettingsTab> = {
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

/** Canonicalize old bookmarks without losing unrelated editor parameters. */
export function resolveSettingsLocation(params: URLSearchParams): string | null {
  const next = new URLSearchParams(params)
  const raw = params.get('section')
  const section = parseSettingsTab(raw)
  const view = params.get('view')
  if (section === 'chat') {
    if (view === 'resources') return '/chat/resources'
    if (view === 'routines') return '/chat/resources?tab=routines'
    if (view === 'profiles') return '/characters?view=profiles'
    if (view === 'mine') { next.set('section', 'mine'); next.delete('view') }
    else if (view === 'judge') { next.set('section', 'llm'); next.set('group', 'log'); next.delete('view') }
  }
  if (section === 'llm' && view === 'content-evaluation') {
    next.set('section', 'posts'); next.set('group', 'topics'); next.delete('view')
  } else if ((section === 'llm' || section === 'posts') && view) {
    next.set('group', view === 'judge' ? 'log' : view); next.delete('view')
  }
  if (!next.has('section') || (raw && LEGACY_SETTINGS_TAB_MAP[raw])) {
    next.set('section', section)
    const groups: Record<string, string> = { appearance: 'appearance', folders: 'folders', metadata: 'metadata', 'image-save': 'image-save', 'llm-connections': 'connections', integration: 'pacing', 'integration-tools': 'comfyui' }
    if (raw && groups[raw] && !next.has('group')) next.set('group', groups[raw])
  }
  const row = SETTINGS_ROW_BY_ID[next.get('setting') ?? '']
  if (row && row.section === parseSettingsTab(next.get('section')) && !next.has('group')) next.set('group', row.group)
  return next.toString() === params.toString() ? null : `/settings?${next}`
}
