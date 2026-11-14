import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import type { PluginHeaderNavigationKey } from '@conai/shared'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { listPlugins, PLUGINS_QUERY_KEY } from '@/lib/api-plugins'
import { pluginPageIcon } from './plugin-page-icon'

export type PluginPageLink = { id: PluginHeaderNavigationKey; to: string; title: string; pluginName: string; icon: LucideIcon }

function usePluginManifests() {
  const auth = useAuthStatusQuery()
  const allowed = auth.data?.authenticated === true || auth.data?.hasCredentials === false
  const plugins = useQuery({ queryKey: PLUGINS_QUERY_KEY, queryFn: listPlugins, enabled: allowed, staleTime: 30_000 })
  return allowed ? (plugins.data ?? []).filter((plugin) => plugin.enabled).map(({ manifest }) => manifest) : []
}

/** Share the launcher cache; permission loss also hides previously cached links. */
export function usePluginPages() {
  return usePluginManifests().flatMap((manifest) =>
    manifest.pages.filter((page) => page.menu !== false).map((page): PluginPageLink => ({
      id: `plugin:${manifest.id}:${page.id}` as const,
      to: `/ext/${manifest.id}/${page.id}`,
      title: page.title,
      pluginName: manifest.name,
      icon: pluginPageIcon(page.icon),
    })),
  )
}

export type PluginImagePage = { key: string; pluginId: string; pageId: string; title: string; pluginName: string; icon: LucideIcon; prompt?: RegExp }

/** Pages that declare `opensImages`: the image detail view lists them to open the current image in the plugin. */
export function usePluginImagePages() {
  return usePluginManifests().flatMap((manifest) =>
    manifest.pages.filter((page) => !!page.opensImages).map((page): PluginImagePage => ({
      key: `plugin:${manifest.id}:${page.id}`,
      pluginId: manifest.id,
      pageId: page.id,
      title: page.title,
      pluginName: manifest.name,
      icon: pluginPageIcon(page.icon),
      prompt: typeof page.opensImages === 'object' ? new RegExp(page.opensImages.prompt) : undefined,
    })),
  )
}
