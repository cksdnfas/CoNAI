import { getPlugin, listPlugins, readInstalledPluginAssets } from '../plugins/pluginRegistry'
import { onPluginChanged, PluginError } from '../plugins/pluginStore'
import { readSkillFolder } from './chatSkillPackages'
import { ChatSkillStore, checkSkillSnapshot, type ChatSkillSnapshot } from './chatSkills'

/**
 * Plugins' skills: a package's manifest names folders (`skills`) that each hold an Agent Skills folder. Installing,
 * updating, switching on or off and removing the plugin brings its shared skills in line (ChatSkillStore.syncPlugin).
 * Only a removed plugin (or a folder its manifest no longer names) takes skills away; one that does not read now
 * turns them off and keeps their ids, so profiles' links and generation presets' guides come back with the fix.
 */
export function syncPluginSkills(pluginId: string) {
  let plugin: ReturnType<typeof getPlugin>
  try { plugin = getPlugin(pluginId, false) } catch (error) {
    if (error instanceof PluginError && error.status === 404) ChatSkillStore.syncPlugin(pluginId, null, false)
    else {
      ChatSkillStore.pluginOff(pluginId)
      console.warn(`[plugin-skills] ${pluginId} could not be read; its skills are off:`, error instanceof Error ? error.message : error)
    }
    return
  }
  const folders = plugin.definition.skills ?? []
  let assets = new Map<string, Buffer>()
  try {
    if (folders.length) assets = readInstalledPluginAssets(pluginId, (name) => folders.some((folder) => name.startsWith(`${folder}/`))).assets
  } catch (error) {
    ChatSkillStore.pluginOff(pluginId)
    console.warn(`[plugin-skills] ${pluginId}'s package could not be read; its skills are off:`, error instanceof Error ? error.message : error)
    return
  }
  const unreadable: string[] = []
  const skills = folders.flatMap((folder): Array<{ folder: string; snapshot: ChatSkillSnapshot }> => {
    try {
      const { draft, warnings } = readSkillFolder(assets, `${folder}/`)
      for (const warning of warnings) console.warn(`[plugin-skills] ${pluginId}/${folder}: ${warning}`)
      return [{ folder, snapshot: checkSkillSnapshot(draft) }]
    } catch (error) {
      unreadable.push(folder)
      console.warn(`[plugin-skills] ${pluginId}/${folder} does not read; its skill is off:`, error instanceof Error ? error.message : error)
      return []
    }
  })
  ChatSkillStore.syncPlugin(pluginId, skills, Boolean(plugin.enabled), unreadable)
}

/** A plugin change never fails over its skills: the install or switch stands, and the reason is logged. */
function syncLogged(pluginId: string) {
  try { syncPluginSkills(pluginId) } catch (error) {
    console.warn(`[plugin-skills] ${pluginId} could not be synced:`, error instanceof Error ? error.message : error)
  }
}

/** Every installed plugin's skills, and none left of plugins that are gone (run at startup). */
export function syncAllPluginSkills() {
  const installed = listPlugins(true).map((plugin) => plugin.manifest.id)
  for (const pluginId of new Set([...installed, ...ChatSkillStore.pluginIds()])) syncLogged(pluginId)
}

onPluginChanged(syncLogged)
