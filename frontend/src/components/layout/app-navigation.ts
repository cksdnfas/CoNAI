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
  /** One line under the name in the menus. */
  description: string | null
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
const BUILT_IN_PAGES: Array<{ path: string; headerKey: BuiltInHeaderKey | null; group: AppNavGroupId | null; description?: TranslationDictionary }> = [
  { path: '/', headerKey: 'home', group: 'library', description: { ko: '이미지와 영상을 모아 보고 검색', en: 'Browse and search images and videos' } },
  { path: '/characters', headerKey: 'characters', group: 'library', description: { ko: '캐릭터 외형과 채팅 프로필', en: 'Character looks and chat profiles' } },
  { path: '/groups', headerKey: 'groups', group: 'library', description: { ko: '이미지를 폴더처럼 묶어 정리', en: 'Sort images into folders' } },
  { path: '/upload', headerKey: 'upload', group: 'library', description: { ko: '이미지와 영상 올리기', en: 'Add images and videos' } },
  { path: '/files', headerKey: 'files', group: 'library', description: { ko: '파일과 폴더 보관', en: 'Keep files and folders' } },
  { path: '/prompts', headerKey: 'prompts', group: 'library', description: { ko: '프롬프트 태그 모음', en: 'Prompt tag collections' } },
  { path: '/wildcards', headerKey: null, group: 'library', description: { ko: '무작위로 바꿔 넣는 태그 목록', en: 'Tag lists picked at random' } },
  { path: '/posts', headerKey: 'posts', group: 'library', description: { ko: '글과 지식 문서', en: 'Posts and knowledge' } },
  { path: '/generation', headerKey: 'generation', group: 'create', description: { ko: '이미지 만들기와 워크플로', en: 'Make images and run workflows' } },
  { path: CODEX_CHAT_ROUTE, headerKey: 'chat', group: 'create', description: { ko: 'AI와 대화하고 작업 맡기기', en: 'Talk with AI and hand over tasks' } },
  { path: '/audio', headerKey: 'audio', group: 'create', description: { ko: '음성과 효과음 만들기', en: 'Make voices and sound effects' } },
  { path: '/sprite', headerKey: 'sprite', group: 'create', description: { ko: '영상 프레임을 스프라이트 시트로', en: 'Turn video frames into sprite sheets' } },
  { path: '/wallpaper', headerKey: 'wallpaper', group: 'create', description: { ko: '위젯과 배경으로 바탕화면 꾸미기', en: 'Lay out widgets and wallpapers' } },
  { path: '/wallpaper/runtime', headerKey: null, group: 'create', description: { ko: '바탕화면에 띄우는 실행 화면', en: 'The live wallpaper screen' } },
  { path: '/extensions', headerKey: null, group: 'extend', description: { ko: '설치된 플러그인 도구', en: 'Installed plugin tools' } },
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

  const builtIns = BUILT_IN_PAGES.flatMap(({ path, headerKey, group, description }) => {
    const entry = PAGE_ACCESS_CATALOG.find((item) => item.path === path)
    if (!entry || (entry.permissionKey && !hasAuthPermission(permissionKeys, entry.permissionKey))) return []
    const link: AppNavLink = { key: headerKey ?? path, to: path, label: t(entry.labelKey), description: description ? t(description) : null, icon: entry.icon, pinned: headerKey !== null && pinnedKeys.has(headerKey) }
    return [{ group, link }]
  })
  // A plugin page's line is its plugin's name, unless that only repeats the page name.
  const plugins: AppNavLink[] = pluginPages.map((page) => ({ key: page.id, to: page.to, label: page.title, description: page.pluginName === page.title ? null : page.pluginName, icon: page.icon, pinned: pinnedKeys.has(page.id) }))
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
