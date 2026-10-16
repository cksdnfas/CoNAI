import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { generationLayoutPluginBlockId, type GenerationLayoutPluginBlock, type GenerationLayoutSurface, type PluginGenerationAction, type PluginPage } from '@conai/shared'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { listPlugins, PLUGINS_QUERY_KEY } from '@/lib/api-plugins'

export type PluginLayoutBlock = { key: GenerationLayoutPluginBlock; pluginId: string; pluginName: string; version: string; page: PluginPage; surfaces: GenerationLayoutSurface[]; height: number }
export type PluginGenerationButton = { key: string; pluginId: string; pluginName: string; action: PluginGenerationAction }

const DEFAULT_BLOCK_HEIGHT = 320

/** Layout blocks and Generate-bar buttons of the enabled plugins, from the shared plugin list cache. */
export function usePluginGenerationContributions() {
  const auth = useAuthStatusQuery()
  const allowed = auth.data?.authenticated === true || auth.data?.hasCredentials === false
  const plugins = useQuery({ queryKey: PLUGINS_QUERY_KEY, queryFn: listPlugins, enabled: allowed, staleTime: 30_000 })
  const data = allowed ? plugins.data : undefined
  return useMemo(() => {
    const blocks: PluginLayoutBlock[] = []
    const buttons: PluginGenerationButton[] = []
    for (const { manifest, enabled } of data ?? []) {
      if (!enabled || !manifest.generation) continue
      for (const block of manifest.generation.blocks) {
        const page = manifest.pages.find((item) => item.id === block.page)
        if (page) blocks.push({ key: generationLayoutPluginBlockId(manifest.id, block.id), pluginId: manifest.id, pluginName: manifest.name, version: manifest.version, page, surfaces: block.surfaces, height: block.height ?? DEFAULT_BLOCK_HEIGHT })
      }
      for (const action of manifest.generation.actions) buttons.push({ key: `${manifest.id}:${action.id}`, pluginId: manifest.id, pluginName: manifest.name, action })
    }
    return { blocks, buttons }
  }, [data])
}
