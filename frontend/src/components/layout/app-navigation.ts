import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { matchPath } from 'react-router-dom'
import { normalizeHeaderNavigationOrder, type HeaderNavigationPageKey, type HeaderNavigationSettings, type PluginHeaderNavigationKey } from '@conai/shared'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { PAGE_ACCESS_CATALOG } from '@/features/auth/page-access-catalog'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { CODEX_CHAT_ROUTE } from '@/features/codex-chat/codex-chat-context'
import { usePluginPages } from '@/features/plugins/use-plugin-pages'
import { useI18n, type TranslationDictionary } from '@/i18n'
import { getPublicHeaderNavigationSettings } from '@/lib/api-settings-general'
import { DEFAULT_HEADER_NAVIGATION_SETTINGS } from '@/lib/settings-defaults'

/** The header's grouped menus; a page that is not pinned to the top bar is reached from its group. */
export type AppNavGroupId = 'library' | 'create' | 'extend'

export interface AppNavLink {
  /** The header key of a pinnable page (built-in or plugin), else the path. */
  key: string
  to: string
  label: string
  icon: LucideIcon
  pinned: boolean
}

export interface AppNavGroup {
  id: AppNavGroupId
  label: string
  links: AppNavLink[]
}

/** Saved by the settings page after a save, so the header follows without a reload. */
export const HEADER_NAVIGATION_QUERY_KEY = ['public-header-navigation-settings'] as const

/** Where the pins are chosen (an administrator's shared setting). */
export const HEADER_PIN_SETTING_PATH = '/settings?section=general&group=display&setting=headerNavigation'

type BuiltInHeaderKey = Exclude<HeaderNavigationPageKey, PluginHeaderNavigationKey>

const GROUPS: Array<{ id: AppNavGroupId; label: TranslationDictionary }> = [
  { id: 'library', label: { ko: '라이브러리', en: 'Library' } },
  { id: 'create', label: { ko: '만들기', en: 'Create' } },
  { id: 'extend', label: { ko: '확장', en: 'Extensions' } },
]

/**
 * Every built-in page the header reaches, in menu order. Wildcards and the plugin list live in a menu only; the
 * available-pages overview (the logo) and Settings (the account menu) can be pinned but sit in no group.
 */
const BUILT_IN_PAGES: Array<{ path: string; headerKey: BuiltInHeaderKey | null; group: AppNavGroupId | null }> = [
  { path: '/', headerKey: 'home', group: 'library' },
  { path: '/characters', headerKey: 'characters', group: 'library' },
  { path: '/groups', headerKey: 'groups', group: 'library' },
  { path: '/upload', headerKey: 'upload', group: 'library' },
  { path: '/files', headerKey: 'files', group: 'library' },
  { path: '/prompts', headerKey: 'prompts', group: 'library' },
  { path: '/wildcards', headerKey: null, group: 'library' },
  { path: '/posts', headerKey: 'posts', group: 'library' },
  { path: '/generation', headerKey: 'generation', group: 'create' },
  { path: CODEX_CHAT_ROUTE, headerKey: 'chat', group: 'create' },
  { path: '/audio', headerKey: 'audio', group: 'create' },
  { path: '/sprite', headerKey: 'sprite', group: 'create' },
  { path: '/wallpaper', headerKey: 'wallpaper', group: 'create' },
  { path: '/wallpaper/runtime', headerKey: null, group: 'create' },
  { path: '/extensions', headerKey: null, group: 'extend' },
  { path: '/access', headerKey: 'access', group: null },
  { path: '/settings', headerKey: 'settings', group: null },
]

/** The page each built-in pinnable key opens (its name and icon come from the page catalog). */
export const HEADER_PAGE_PATHS = Object.fromEntries(
  BUILT_IN_PAGES.flatMap(({ path, headerKey }) => (headerKey ? [[headerKey, path]] : [])),
) as Record<BuiltInHeaderKey, string>

/** Whether a header link is the current page (the gallery only on its own address). */
export function isAppNavLinkActive(to: string, pathname: string) {
  return matchPath({ path: to, end: to === '/' }, pathname) !== null
}

/**
 * The header's pages for this account: the pinned ones in their saved order, every page it may open in its menu group
 * (plugin pages in 확장) and the pages in no group (`ungrouped`). `items` also carries the right-side tool switches.
 */
export function useAppNavigation() {
  const { t } = useI18n()
  const permissionKeys = useAuthStatusQuery().data?.permissionKeys ?? []
  const pluginPages = usePluginPages()
  const settingsQuery = useQuery({ queryKey: HEADER_NAVIGATION_QUERY_KEY, queryFn: getPublicHeaderNavigationSettings, staleTime: 60_000 })
  const items: HeaderNavigationSettings = settingsQuery.data?.items ?? DEFAULT_HEADER_NAVIGATION_SETTINGS
  const order = normalizeHeaderNavigationOrder(settingsQuery.data?.order, pluginPages.map((page) => page.id))
  const pinnedKeys = new Set<string>(order.filter((key) => items[key] === true))

  const builtIns = BUILT_IN_PAGES.flatMap(({ path, headerKey, group }) => {
    const entry = PAGE_ACCESS_CATALOG.find((item) => item.path === path)
    if (!entry || (entry.permissionKey && !hasAuthPermission(permissionKeys, entry.permissionKey))) return []
    const link: AppNavLink = { key: headerKey ?? path, to: path, label: t(entry.labelKey), icon: entry.icon, pinned: headerKey !== null && pinnedKeys.has(headerKey) }
    return [{ group, link }]
  })
  const plugins: AppNavLink[] = pluginPages.map((page) => ({ key: page.id, to: page.to, label: page.title, icon: page.icon, pinned: pinnedKeys.has(page.id) }))
  const linkByKey = new Map([...builtIns.map(({ link }) => link), ...plugins].map((link) => [link.key, link]))
  const pinned = order.flatMap((key) => (pinnedKeys.has(key) ? linkByKey.get(key) ?? [] : []))
  const inGroup = (id: AppNavGroupId) => builtIns.filter(({ group }) => group === id).map(({ link }) => link)
  const groups: AppNavGroup[] = GROUPS.map(({ id, label }) => ({
    id,
    label: t(label),
    // Plugin pages lead 확장; the plugin list closes it.
    links: id === 'extend' ? [...plugins, ...inGroup(id)] : inGroup(id),
  })).filter((group) => group.links.length > 0)
  const ungrouped = builtIns.filter(({ group }) => group === null).map(({ link }) => link)

  return { items, pinned, groups, ungrouped }
}
