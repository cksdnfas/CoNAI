import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { PathCrumb } from '@/components/common/path-breadcrumbs'
import { useI18n } from '@/i18n'

/** The chat workspace: /chat is the conversations, the other screens manage what the chats draw on (administrators). */
export const CHAT_WORKSPACE_PATHS = {
  chat: '/chat',
  profiles: '/chat/profiles',
  resources: '/chat/resources',
  llm: '/chat/llm',
  routines: '/chat/routines',
  judge: '/chat/judge',
  mine: '/chat/mine',
} as const

export type ChatResourceTab = 'presets' | 'blocks' | 'lorebooks'
export const CHAT_RESOURCE_TABS: readonly ChatResourceTab[] = ['presets', 'blocks', 'lorebooks']
export const parseChatResourceTab = (value: string | null): ChatResourceTab => (CHAT_RESOURCE_TABS as readonly (string | null)[]).includes(value) ? value as ChatResourceTab : 'presets'

/**
 * Settings › 채팅 from top to bottom: the chat-wide options, then what the chats draw on (profiles, resources, routines),
 * then the records and shared flags. Each id is a `?group=` anchor of that section.
 */
export const CHAT_SETTINGS_OPTION_GROUPS = ['basic', 'memory', 'tools', 'web', 'diagnostics'] as const
export const CHAT_SETTINGS_GROUPS = [...CHAT_SETTINGS_OPTION_GROUPS, 'profiles', 'presets', 'blocks', 'lorebooks', 'routines', 'judge', 'flags'] as const
export type ChatSettingsGroup = (typeof CHAT_SETTINGS_GROUPS)[number]

/** The library state a profile list keeps in its address while one of its editors is open. */
const LIST_PARAMS = ['folder', 'q', 'page'] as const

/**
 * Every chat management screen lives in two places: the chat workspace and Settings.
 * The same components serve both, so what they link to follows the host.
 */
export type ChatAdminHost = 'workspace' | 'settings'
export const chatAdminHostOf = (pathname: string): ChatAdminHost => (pathname.startsWith('/settings') ? 'settings' : 'workspace')

function withParams(base: string, params: Record<string, string>, keep?: URLSearchParams) {
  const next = new URLSearchParams(params)
  if (keep) for (const key of LIST_PARAMS) { const value = keep.get(key); if (value) next.set(key, value) }
  const query = next.toString()
  return query ? `${base}?${query}` : base
}

export function chatAdminLinks(host: ChatAdminHost, current?: URLSearchParams) {
  const settings = host === 'settings'
  return {
    host,
    /** The profile list; `keep` carries the open folder, search and page from the current address. */
    profiles: (keep = false) => settings ? withParams('/settings', { section: 'chat', group: 'profiles' }, keep ? current : undefined) : withParams(CHAT_WORKSPACE_PATHS.profiles, {}, keep ? current : undefined),
    profile: (id: number | 'new') => settings ? withParams('/settings', { section: 'chat', profile: String(id) }, current) : withParams(CHAT_WORKSPACE_PATHS.profiles, { profile: String(id) }, current),
    resources: (tab: ChatResourceTab = 'presets') => settings ? withParams('/settings', { section: 'chat', group: tab }) : withParams(CHAT_WORKSPACE_PATHS.resources, { tab }),
    llm: (group?: 'connections' | 'dashboard') => settings ? withParams('/settings', { section: 'llm', ...(group ? { group } : {}) }) : withParams(CHAT_WORKSPACE_PATHS.llm, group ? { group } : {}),
    judge: () => settings ? withParams('/settings', { section: 'chat', group: 'judge' }) : CHAT_WORKSPACE_PATHS.judge,
    /** A lorebook's editor page: a shared book by id, an account book as `account-<id>`, or `new` / `new-account`. */
    lorebook: (key: string) => settings ? withParams('/settings', { section: 'chat', lorebook: key }) : withParams(CHAT_WORKSPACE_PATHS.resources, { tab: 'lorebooks', lorebook: key }),
  }
}

/** Links of the host the calling screen is in. */
export function useChatAdminLinks() {
  const { pathname, search } = useLocation()
  return useMemo(() => chatAdminLinks(chatAdminHostOf(pathname), new URLSearchParams(search)), [pathname, search])
}

/** The path above an editor page (the last crumb is where its back arrow goes): Settings › 채팅 › the list, or just the list in the workspace. */
export function useChatAdminCrumbs(screen: 'profiles' | 'lorebooks'): PathCrumb[] {
  const { t } = useI18n()
  const navigate = useNavigate()
  const links = useChatAdminLinks()
  const list: PathCrumb = screen === 'profiles'
    ? { key: 'profiles', label: t({ ko: '프로필', en: 'Profiles' }), onClick: () => navigate(links.profiles(true)) }
    : { key: 'lorebooks', label: t({ ko: '로어북', en: 'Lorebooks' }), onClick: () => navigate(links.resources('lorebooks')) }
  if (links.host === 'settings') return [
    { key: 'settings', label: t({ ko: '설정', en: 'Settings' }), onClick: () => navigate('/settings') },
    { key: 'chat', label: t({ ko: '채팅', en: 'Chat' }), onClick: () => navigate('/settings?section=chat') },
    list,
  ]
  // The workspace's tab row above already names the chat; the list is the only step back.
  return [list]
}
