import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import type { PluginHeaderNavigationKey } from '@conai/shared'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { listPlugins, PLUGINS_QUERY_KEY } from '@/lib/api-plugins'
import { pluginPageIcon } from './plugin-page-icon'

export type PluginPageLink = { id: PluginHeaderNavigationKey; to: string; title: string; pluginName: string; icon: LucideIcon }

/** Share the launcher cache; permission loss also hides previously cached links. */
export function usePluginPages() {
  const auth = useAuthStatusQuery()
  const allowed = auth.data?.authenticated === true || auth.data?.hasCredentials === false
  const plugins = useQuery({ queryKey: PLUGINS_QUERY_KEY, queryFn: listPlugins, enabled: allowed, staleTime: 30_000 })
  const pages: PluginPageLink[] = allowed ? (plugins.data ?? []).filter((plugin) => plugin.enabled).flatMap(({ manifest }) =>
    manifest.pages.filter((page) => page.menu !== false).map((page) => ({
      id: `plugin:${manifest.id}:${page.id}` as const,
      to: `/ext/${manifest.id}/${page.id}`,
      title: page.title,
      pluginName: manifest.name,
      icon: pluginPageIcon(page.icon),
    })),
  ) : []
  return pages
}
