import { CHAT_PAGE_TOOLS, CHAT_ROOM_TOOLS, CHAT_SETTINGS_TOOLS, getMcpToolScope } from '../../mcp/context'
import { nativeToolNames } from '../../mcp/toolAccess'
import { pluginServerTools } from './pluginServerTools'
import { PluginError } from './pluginStore'
import type { McpHttpScope, PluginCapability, PluginManifest } from '@conai/shared'

// These handlers require an active chat/page, or recurse through this bridge. They are unavailable in a
// plugin execution, regardless of account permissions; do not advertise tools that can never run here.
const chatOnly = new Set([
  ...CHAT_PAGE_TOOLS, ...CHAT_ROOM_TOOLS, ...CHAT_SETTINGS_TOOLS,
  'propose_display_block', 'propose_skill', 'propose_chat_profile', 'propose_profile_update', 'propose_profile_assets', 'propose_character_library', 'propose_art_style',
  'get_asset_batch', 'posts_propose_knowledge', 'web_search', 'web_read',
  'list_plugin_drafts', 'create_plugin_draft', 'read_plugin_draft', 'edit_plugin_draft', 'prepare_plugin_install', 'check_plugin_updates',
])
/** Enabled plugins are app features. The native tool checks the current account, scope and input. */
export function pluginAppToolScope(name: string) {
  if (chatOnly.has(name) || /^(?:list_plugin_|run_plugin_|get_plugin_|cancel_plugin_)/.test(name)) return null
  if (['workspace_list', 'workspace_read', 'workspace_search'].includes(name)) return 'read' as const
  if (name === 'workspace_apply') return 'organize' as const
  return getMcpToolScope(name)
}
export function pluginAppTools() {
  return [...nativeToolNames(), ...pluginServerTools().map(tool => tool.name)].filter(name => pluginAppToolScope(name)).sort()
}

/** The tool scope each host feature acts in (`server` adds the scopes of the module's registered tools instead). */
const CAPABILITY_SCOPES: Record<PluginCapability, McpHttpScope | null> = {
  'files.read': 'read', 'files.media': 'read', 'workspace.read': 'read', 'workspace.media': 'read', 'media.read': 'read', 'media.pick': 'read',
  'files.write': 'organize', 'workspace.write': 'organize', 'media.process': 'organize', 'media.save': 'organize',
  jobs: 'generate', server: null,
}
/** Every scope a plugin can act in: its declared app tools, its server module's tools and its host features. */
export function pluginReachScopes(manifest: Pick<PluginManifest, 'id' | 'appTools' | 'capabilities'>): McpHttpScope[] {
  const tools = (manifest.appTools ?? []).map(pluginAppToolScope)
  const server = pluginServerTools().filter(tool => tool.pluginId === manifest.id).map(tool => tool.scope)
  const features = manifest.capabilities.map(capability => CAPABILITY_SCOPES[capability])
  return [...new Set([...tools, ...server, ...features].filter((scope): scope is McpHttpScope => !!scope))].sort()
}
/** A chat profile drives a plugin only when its tool scopes cover all the plugin can reach (null: not a chat). */
export function pluginWithinScopes(manifest: Pick<PluginManifest, 'id' | 'appTools' | 'capabilities'>, scopes: readonly McpHttpScope[] | null) {
  return !scopes || pluginReachScopes(manifest).every(scope => scopes.includes(scope))
}
export function requirePluginWithinScopes(manifest: Pick<PluginManifest, 'id' | 'appTools' | 'capabilities'>, scopes: readonly McpHttpScope[] | null) {
  if (!pluginWithinScopes(manifest, scopes)) throw new PluginError(`이 프로필의 도구 설정이 이 확장이 쓰는 범위를 다 포함하지 않아: ${pluginReachScopes(manifest).filter(scope => !scopes!.includes(scope)).join(', ')}`, 403)
}
